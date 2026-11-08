import { useEffect, useState } from 'react';
import { Play, Trash2, ArrowRightLeft, ShoppingBag, CreditCard, Bookmark, History } from 'lucide-react';
import { useApp } from '../state.jsx';
import { api } from '../lib/api.js';
import { money, shortDate, RISK } from '../lib/format.js';
import ImpactPreview from '../components/ImpactPreview.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ChannelCard from '../components/ChannelCard.jsx';
import { SafeToSpendCard, NetWorthCard, HealthScore, HealthIndicators, AccountsPanel, BillsList, TransactionsList, DataNote } from '../components/widgets.jsx';

export function Dashboard() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <SafeToSpendCard />
        <HealthScore />
        <NetWorthCard />
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7"><ImpactPreview height={330} /></div>
        <div className="xl:col-span-5"><ChatPanel /></div>
      </div>
      <HealthIndicators />
      <div className="grid gap-5 lg:grid-cols-3">
        <AccountsPanel />
        <BillsList />
        <TransactionsList />
      </div>
      <DataNote />
    </div>
  );
}

export function Assistant() {
  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <div className="xl:col-span-6"><ChatPanel tall /></div>
      <div className="space-y-5 xl:col-span-6">
        <ImpactPreview height={340} />
        <ChannelCard />
        <BillsList limit={5} />
      </div>
    </div>
  );
}

export function Accounts() {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <NetWorthCard />
        <HealthScore />
      </div>
      <AccountsPanel full />
      <HealthIndicators />
      <DataNote />
    </div>
  );
}

export function Transactions() {
  const { overview } = useApp();
  const [activity, setActivity] = useState([]);
  useEffect(() => { api.activity().then((r) => setActivity(r.pending)).catch(() => {}); }, [overview]);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2"><TransactionsList limit={25} title="All transactions" /></div>
      <section className="card card-pad">
        <div className="flex items-center gap-2"><History size={16} className="text-sage" /><h2 className="font-display text-lg font-semibold">Chatter Bank audit trail</h2></div>
        <p className="mt-1 text-xs text-forest/60">Every transfer Chatter Bank prepared, and what you decided.</p>
        <ul className="mt-3 space-y-2">
          {activity.length === 0 && <li className="text-sm text-forest/55">Nothing yet. Ask the assistant to move money.</li>}
          {activity.map((p) => (
            <li key={p._id} className="rounded-xl bg-cream-200/60 px-3 py-2 text-sm">
              <div className="flex justify-between"><span className="font-medium">{money(p.amount)}</span>
                <span className={`chip !py-0 text-[10px] ${p.status === 'executed' ? 'bg-sage-soft text-sage' : p.status === 'pending' ? 'bg-gold-soft text-gold-deep' : 'bg-cream-300 text-forest/60'}`}>{p.status}</span></div>
              <div className="truncate text-[11px] text-forest/60">{p.label}</div>
              <div className="text-[10px] text-forest/45">
                via {p.channel && p.channel !== 'web' ? p.channel : 'web app'}{p.nessieTransferId ? ' · written to Nessie' : ''}{p.syncNote ? ` · ${p.syncNote}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="lg:col-span-3"><ChannelCard /></div>
    </div>
  );
}

const MODES = [
  { id: 'transfer', label: 'Transfer', icon: ArrowRightLeft },
  { id: 'purchase', label: 'Purchase', icon: ShoppingBag },
  { id: 'payment', label: 'Pay debt', icon: CreditCard },
];

export function Forecast() {
  const { overview, showScenarios, scenarios, setPending, notify } = useApp();
  const [mode, setMode] = useState('transfer');
  const [amount, setAmount] = useState(500);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payWith, setPayWith] = useState('');
  const [desc, setDesc] = useState('New laptop');
  const [error, setError] = useState(null);
  const [list, setList] = useState([]);
  const [running, setRunning] = useState(false);

  const cash = overview.accounts.filter((a) => ['checking', 'savings'].includes(a.type));
  const debts = overview.accounts.filter((a) => a.kind === 'liability');
  const payers = overview.accounts.filter((a) => a.type === 'checking' || a.type === 'credit_card');

  useEffect(() => {
    setFrom(cash.find((a) => a.type === 'checking')?.id || '');
    setTo(mode === 'payment' ? debts[0]?.id : cash.find((a) => a.type === 'savings')?.id || '');
    setPayWith(payers[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, overview]);

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      const body = mode === 'purchase'
        ? { type: 'purchase', amount: Number(amount), accountId: payWith, description: desc }
        : { type: 'transfer', amount: Number(amount), from, to };
      const { scenario } = await api.simulate(body);
      const next = [...list, scenario].slice(-3);
      setList(next);
      showScenarios(next.slice(-2), next.length > 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const proceed = async (s) => {
    try {
      const { pending } = await api.createPending(s.id);
      setPending(pending);
    } catch (e) {
      notify(e.message);
    }
  };

  const timeline = overview.forecast.series.filter((p) => p.events.length);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-12">
        <section className="card card-pad xl:col-span-4">
          <h2 className="font-display text-lg font-semibold">What-if simulator</h2>
          <p className="text-xs text-forest/60">Try a decision. Nothing moves until you confirm.</p>
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-cream-200 p-1" role="tablist">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${mode === id ? 'bg-white text-forest shadow-sm' : 'text-forest/60'}`}>
                <Icon size={14} /><span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <label className="mt-4 block text-xs font-semibold text-forest/70" htmlFor="amt">Amount</label>
          <div className="mt-1 flex items-center gap-3">
            <input id="amt" type="number" min="1" step="10" value={amount} onChange={(e) => setAmount(e.target.value)} className="input num w-32" />
            <input type="range" min="10" max="3000" step="10" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 accent-[#43846E]" aria-label="Amount slider" />
          </div>

          {mode === 'purchase' ? (
            <>
              <label className="mt-3 block text-xs font-semibold text-forest/70" htmlFor="desc">What is it?</label>
              <input id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} className="input mt-1" />
              <label className="mt-3 block text-xs font-semibold text-forest/70" htmlFor="pay">Pay with</label>
              <select id="pay" value={payWith} onChange={(e) => setPayWith(e.target.value)} className="input mt-1">
                {payers.map((a) => <option key={a.id} value={a.id}>{a.nickname} •••• {a.mask}</option>)}
              </select>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-forest/70" htmlFor="from">From</label>
                <select id="from" value={from} onChange={(e) => setFrom(e.target.value)} className="input mt-1">
                  {cash.map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-forest/70" htmlFor="to">To</label>
                <select id="to" value={to} onChange={(e) => setTo(e.target.value)} className="input mt-1">
                  {(mode === 'payment' ? debts : cash).map((a) => <option key={a.id} value={a.id}>{a.nickname}</option>)}
                </select>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-clay-deep">{error}</p>}
          <button onClick={run} disabled={running || !(Number(amount) > 0)} className="btn-primary mt-4 w-full"><Play size={15} />{running ? 'Simulating…' : 'Run simulation'}</button>

          {list.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between"><span className="eyebrow">This session</span>
                <button onClick={() => { setList([]); showScenarios([]); }} className="btn-ghost !px-2 !py-1 text-xs"><Trash2 size={13} />Clear</button></div>
              <ul className="mt-2 space-y-2">
                {[...list].reverse().map((s) => (
                  <li key={s.id} className="rounded-xl border border-cream-300 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => showScenarios([s], false)} className="text-left text-sm font-semibold hover:text-sage">{s.label}</button>
                      <span className={`chip shrink-0 ${RISK[s.riskLevel].cls}`}>{RISK[s.riskLevel].label}</span>
                    </div>
                    <p className="mt-1 text-xs text-forest/65">{s.headline}</p>
                    {s.type === 'transfer' && <button onClick={() => proceed(s)} className="btn-outline mt-2 !py-1.5 text-xs">Set up this transfer</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <div className="xl:col-span-8"><ImpactPreview height={420} /></div>
      </div>

      <section className="card card-pad">
        <h2 className="font-display text-lg font-semibold">30-day money timeline</h2>
        <p className="text-xs text-forest/60">Known paychecks and bills, with your projected checking balance after each day (includes ~{money(overview.user.dailySpend)}/day everyday spending).</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-forest/50"><th className="py-2 pr-3 font-semibold">Date</th><th className="pr-3 font-semibold">What happens</th><th className="pr-3 text-right font-semibold">Amount</th><th className="text-right font-semibold">Checking after</th></tr></thead>
            <tbody className="divide-y divide-cream-200">
              {timeline.map((p) => p.events.map((e, i) => (
                <tr key={`${p.day}-${i}`}>
                  <td className="py-2 pr-3 text-forest/70">{i === 0 ? shortDate(p.date) : ''}</td>
                  <td className="pr-3">{e.label}</td>
                  <td className={`num pr-3 text-right ${e.amount > 0 ? 'text-sage' : ''}`}>{money(e.amount, { sign: true })}</td>
                  <td className={`num text-right font-semibold ${p.balance < overview.forecast.threshold ? 'text-clay-deep' : ''}`}>{i === p.events.length - 1 ? money(p.balance) : ''}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function Scenarios() {
  const { showScenarios, setPage } = useApp();
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState([]);
  useEffect(() => { api.scenarios().then((r) => setItems(r.scenarios)).catch(() => setItems([])); }, []);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const view = () => { showScenarios(items.filter((s) => selected.includes(s.id)), selected.length > 1); setPage('forecast'); };

  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Bookmark size={16} className="text-sage" /><h2 className="font-display text-lg font-semibold">Saved scenarios</h2></div>
        <button onClick={view} disabled={!selected.length} className="btn-primary">{selected.length > 1 ? 'Compare selected' : 'View on chart'}</button>
      </div>
      <p className="mt-1 text-xs text-forest/60">Every simulation from chat or the simulator is saved{' '}so you can revisit and compare decisions. Select up to two.</p>
      {items === null ? <div className="mt-4 h-24 animate-pulse rounded-xl bg-cream-200" /> : items.length === 0 ? (
        <p className="mt-4 text-sm text-forest/60">No scenarios yet. Ask “Transfer $1,000 to savings” or run the simulator.</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {items.map((s) => (
            <li key={s.id}>
              <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${selected.includes(s.id) ? 'border-sage bg-sage-soft/40' : 'border-cream-300 bg-white hover:border-sage/60'}`}>
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="mt-1 accent-[#43846E]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <span className={`chip shrink-0 ${RISK[s.riskLevel].cls}`}>{RISK[s.riskLevel].label}</span>
                  </div>
                  <p className="mt-1 text-xs text-forest/65">{s.headline}</p>
                  <p className="mt-1 text-[11px] text-forest/45">{new Date(s.createdAt).toLocaleString()}</p>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

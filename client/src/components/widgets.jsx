import { Wallet, PiggyBank, CreditCard, Landmark, TrendingUp, Car, GraduationCap, Home, CalendarClock, ShieldCheck, Info, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useApp } from '../state.jsx';
import { money, shortDate, relDays, ACCOUNT_LABEL, STATUS } from '../lib/format.js';

const ICON = { checking: Wallet, savings: PiggyBank, credit_card: CreditCard, cd: Landmark, ira: TrendingUp, auto_loan: Car, student_loan: GraduationCap, mortgage: Home };

export function SafeToSpendCard() {
  const { overview, send, setPage } = useApp();
  const s = overview.safeToSpend;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-forest p-5 text-cream shadow-card">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sage/30" aria-hidden />
      <div className="absolute -bottom-12 right-10 h-28 w-28 rounded-full bg-gold/15" aria-hidden />
      <div className="relative">
        <div className="flex items-center gap-2 text-gold"><ShieldCheck size={15} /><span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Safe to spend</span></div>
        <div className="mt-2 font-display text-4xl font-semibold num">{money(s.amount)}</div>
        <p className="mt-1.5 max-w-sm text-sm text-cream/80">
          Keeps checking above your {money(s.threshold)} cushion for 30 days. Tightest day {shortDate(s.lowestDate)}; next paycheck {shortDate(s.nextPayDate)}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => { setPage('assistant'); send('How much can I safely spend before payday?'); }} className="btn !bg-cream !text-forest hover:!bg-gold">Ask why</button>
          <button onClick={() => setPage('forecast')} className="btn border border-cream/30 text-cream hover:bg-cream/10">Try a what-if</button>
        </div>
      </div>
    </section>
  );
}

export function NetWorthCard() {
  const { overview } = useApp();
  const nw = overview.health.netWorth;
  const pct = nw.assets + nw.liabilities > 0 ? (nw.assets / (nw.assets + nw.liabilities)) * 100 : 50;
  return (
    <section className="card card-pad">
      <div className="eyebrow">Net worth · all accounts</div>
      <div className={`mt-2 font-display text-3xl font-semibold num ${nw.net < 0 ? 'text-clay-deep' : ''}`}>{money(nw.net)}</div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-clay-soft" role="img" aria-label={`Assets ${money(nw.assets)}, owed ${money(nw.liabilities)}`}>
        <div className="bg-sage" style={{ width: `${pct}%` }} />
        <div className="bg-clay" style={{ width: `${100 - pct}%` }} />
      </div>
      <div className="mt-2.5 flex justify-between text-xs">
        <span><span className="text-forest/55">Assets</span> <span className="num font-semibold">{money(nw.assets)}</span></span>
        <span><span className="text-forest/55">Owed</span> <span className="num font-semibold">{money(nw.liabilities)}</span></span>
      </div>
      <div className="mt-3 rounded-xl bg-cream-200/60 px-3 py-2 text-xs text-forest/70">
        Cash on hand <span className="num font-semibold text-forest">{money(nw.liquid)}</span> across checking and savings.
      </div>
    </section>
  );
}

export function HealthScore() {
  const { overview } = useApp();
  const h = overview.health;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const color = h.score >= 80 ? '#43846E' : h.score >= 60 ? '#9A7B2E' : '#D68167';
  return (
    <section className="card card-pad">
      <div className="eyebrow">Financial health</div>
      <div className="mt-2 flex items-center gap-4">
        <svg width="108" height="108" viewBox="0 0 108 108" className="shrink-0" role="img" aria-label={`Health score ${h.score} out of 100`}>
          <circle cx="54" cy="54" r={r} fill="none" stroke="#F2EDE0" strokeWidth="10" />
          <circle cx="54" cy="54" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - h.score / 100)} transform="rotate(-90 54 54)" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          <text x="54" y="58" textAnchor="middle" className="font-display" fontSize="28" fontWeight="600" fill="#19392F">{h.score}</text>
          <text x="54" y="75" textAnchor="middle" fontSize="10" fill="#19392F99">of 100</text>
        </svg>
        <div className="min-w-0">
          <div className="font-display text-xl font-semibold">{h.grade}</div>
          <div className="mt-1 text-xs font-semibold text-forest/60">Focus: {h.focus.label}</div>
          <p className="mt-1 text-xs leading-relaxed text-forest/70">{h.focus.tip}</p>
        </div>
      </div>
    </section>
  );
}

export function HealthIndicators() {
  const { overview } = useApp();
  return (
    <section aria-label="Health indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {overview.health.indicators.map((i) => {
        const st = STATUS[i.status];
        return (
          <div key={i.key} className="card p-4" title={i.explain}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-forest/65">{i.label}</span>
              <span className={`chip !px-2 !py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
            </div>
            <div className="mt-1.5 font-display text-2xl font-semibold num">{i.display}</div>
            <p className="mt-1 text-[11px] leading-snug text-forest/60">{i.explain}</p>
          </div>
        );
      })}
    </section>
  );
}

function AccountRow({ a }) {
  const Icon = ICON[a.type] || Wallet;
  const util = a.limit ? Math.round((a.balance / a.limit) * 100) : null;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${a.kind === 'liability' ? 'bg-clay-soft text-clay-deep' : 'bg-sage-soft text-sage'}`}><Icon size={17} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{a.nickname}</div>
        <div className="text-[11px] text-forest/55">
          {ACCOUNT_LABEL[a.type] || a.type} •••• {a.mask}
          {a.apy ? ` · ${a.apy}% APY` : ''}{a.apr ? ` · ${a.apr}% APR` : ''}
          {a.source === 'linked' ? ' · linked' : a.source === 'nessie' ? ' · Nessie' : ''}
        </div>
        {util != null && (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200"><div className={`h-full ${util > 30 ? 'bg-clay' : 'bg-sage'}`} style={{ width: `${Math.min(100, util)}%` }} /></div>
            <span className="text-[10px] text-forest/55">{util}% of {money(a.limit)}</span>
          </div>
        )}
      </div>
      <div className={`num text-right text-sm font-semibold ${a.kind === 'liability' ? 'text-clay-deep' : ''}`}>
        {a.kind === 'liability' ? '−' : ''}{money(a.balance)}
        {a.monthlyPayment ? <div className="text-[10px] font-normal text-forest/55">{money(a.monthlyPayment)}/mo</div> : null}
      </div>
    </div>
  );
}

export function AccountsPanel({ full = false }) {
  const { overview } = useApp();
  const groups = [
    { title: 'Cash', items: overview.accounts.filter((a) => ['checking', 'savings'].includes(a.type)) },
    { title: 'Savings & investments', items: overview.accounts.filter((a) => ['cd', 'ira'].includes(a.type)) },
    { title: 'Credit & loans', items: overview.accounts.filter((a) => a.kind === 'liability') },
  ];
  return (
    <section className="card card-pad">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">All accounts</h2>
        <span className="text-xs text-forest/55">{overview.accounts.length} accounts · 360° view</span>
      </div>
      <div className={full ? 'mt-2 grid gap-x-8 lg:grid-cols-3' : 'mt-2'}>
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.title} className="mt-2">
            <div className="eyebrow">{g.title}</div>
            <div className="divide-y divide-cream-200">{g.items.map((a) => <AccountRow key={a.id} a={a} />)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BillsList({ limit = 6 }) {
  const { overview } = useApp();
  const next = overview.user.nextPayDate;
  return (
    <section className="card card-pad">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Upcoming obligations</h2>
        <CalendarClock size={16} className="text-forest/45" />
      </div>
      <ol className="mt-3 space-y-1">
        {overview.bills.slice(0, limit).map((b, i, arr) => {
          const beforePay = b.dueDate < next && (i === arr.length - 1 || arr[i + 1].dueDate >= next);
          return (
            <li key={b.id}>
              <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-cream-200/50">
                <div className="w-12 shrink-0 text-center">
                  <div className="text-[10px] uppercase text-forest/50">{shortDate(b.dueDate).split(' ')[0]}</div>
                  <div className="font-display text-lg font-semibold leading-none">{shortDate(b.dueDate).split(' ')[1]}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.payee}</div>
                  <div className="text-[11px] text-forest/55">{relDays(b.inDays)} · {b.category}</div>
                </div>
                <div className="num text-sm font-semibold">{money(b.amount)}</div>
              </div>
              {beforePay && (
                <div className="my-1 flex items-center gap-2 px-2 text-[11px] font-semibold text-sage">
                  <span className="h-px flex-1 bg-sage/40" />Paycheck {money(overview.user.payAmount)} · {shortDate(next)}<span className="h-px flex-1 bg-sage/40" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function TransactionsList({ limit = 6, title = 'Recent transactions' }) {
  const { overview } = useApp();
  const name = (id) => overview.accounts.find((a) => a.id === id)?.nickname || '';
  return (
    <section className="card card-pad">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <ul className="mt-2 divide-y divide-cream-200">
        {overview.transactions.slice(0, limit).map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${t.amount > 0 ? 'bg-sage-soft text-sage' : 'bg-cream-200 text-forest/60'}`}>
              {t.amount > 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.description}{t.via && <span className="chip ml-2 !py-0 bg-gold-soft text-gold-deep text-[10px]">MoneyCall</span>}</div>
              <div className="text-[11px] text-forest/55">{shortDate(t.date)} · {name(t.accountId)}</div>
            </div>
            <div className={`num text-sm font-semibold ${t.amount > 0 ? 'text-sage' : ''}`}>{money(t.amount, { sign: true })}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DataNote() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-forest/50">
      <Info size={12} /> Demo banking with synthetic data. Projections are estimates, not financial advice.
    </p>
  );
}

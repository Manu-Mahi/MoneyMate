import { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot } from 'recharts';
import { AlertTriangle, CheckCircle2, LineChart as LineIcon, X } from 'lucide-react';
import { useApp } from '../state.jsx';
import { compact, money, shortDate, RISK } from '../lib/format.js';

const C = { forest: '#19392F', sage: '#43846E', gold: '#E8D7AB', goldDeep: '#9A7B2E', clay: '#D68167', grid: '#E6DFCC' };
const riskColor = { low: C.forest, medium: C.goldDeep, high: C.clay };

function TooltipBox({ active, payload, lines }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-cream-300 bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-forest">{row.day === 0 ? 'Today' : `Day ${row.day}`} · {shortDate(row.date)}</div>
      {lines.map((l) => row[l.key] != null && (
        <div key={l.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-forest/70"><span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.name}</span>
          <span className={`num font-semibold ${row[l.key] < 0 ? 'text-clay-deep' : 'text-forest'}`}>{money(row[l.key])}</span>
        </div>
      ))}
      {row.events?.length > 0 && (
        <div className="mt-1.5 border-t border-cream-200 pt-1.5 text-forest/70">
          {row.events.map((e, i) => (
            <div key={i} className="flex justify-between gap-4"><span>{e.label}</span><span className="num">{money(e.amount, { sign: true })}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImpactPreview({ height = 280, compact: small = false }) {
  const { overview, scenarios, compared, setScenarios } = useApp();

  const { rows, lines, threshold, lows } = useMemo(() => {
    if (!overview) return { rows: [], lines: [] };
    const base = scenarios[0]?.baseline?.series || overview.forecast.series;
    const eventSource = scenarios[0]?.scenario?.series || overview.forecast.series;
    const ls = [{ key: 'baseline', name: scenarios.length ? 'Without change' : 'Projected checking', color: C.sage, dash: scenarios.length ? '0' : '0' }];
    scenarios.forEach((s, i) => {
      const short = s.type === 'transfer' ? `With ${money(s.amount)} ${s.to?.nickname?.toLowerCase().includes('card') ? 'payment' : 'transfer'}` : `With ${money(s.amount)} purchase`;
      ls.push({ key: `s${i}`, name: short, color: compared && i === 0 ? C.clay : riskColor[s.riskLevel] || C.forest, dash: compared && i === 0 ? '6 4' : '0', risk: s.riskLevel });
    });
    const rs = base.map((p, d) => {
      const row = { day: p.day, date: p.date, baseline: p.balance, events: eventSource[d]?.events || [] };
      scenarios.forEach((s, i) => { row[`s${i}`] = s.scenario?.series?.[d]?.balance; });
      return row;
    });
    const lowPts = scenarios.map((s, i) => ({ ...s.scenario.lowest, color: ls[i + 1].color }));
    return { rows: rs, lines: ls, threshold: overview.forecast.threshold, lows: lowPts };
  }, [overview, scenarios, compared]);

  if (!overview) return <div className="card card-pad h-72 animate-pulse" />;

  const active = scenarios.at(-1);
  const risk = active ? RISK[active.riskLevel] : null;
  const creditOnly = active && active.channel === 'credit';

  return (
    <section className="card card-pad" aria-label="Financial impact preview">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <LineIcon size={16} className="text-sage" />
            <h2 className="font-display text-lg font-semibold">Financial Impact Preview</h2>
          </div>
          <p className="text-xs text-forest/60">30-day checking forecast · bills, paychecks and everyday spending</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {lines.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5 text-forest/75">
              <span className="h-0.5 w-4 rounded" style={{ background: l.color }} />{l.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-forest/75"><span className="h-0.5 w-4 border-t-2 border-dashed border-gold-deep" />Cushion {money(threshold)}</span>
          {scenarios.length > 0 && (
            <button onClick={() => setScenarios([])} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Clear scenario"><X size={14} />Clear</button>
          )}
        </div>
      </div>

      <div style={{ height: small ? height - 60 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: C.grid }} tick={{ fill: '#19392F99', fontSize: 11 }}
              ticks={[0, 5, 10, 15, 20, 25, 30]} tickFormatter={(d) => (d === 0 ? 'Today' : shortDate(rows[d]?.date))} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={{ fill: '#19392F99', fontSize: 11 }} tickFormatter={compact} />
            <Tooltip content={<TooltipBox lines={lines} />} />
            <ReferenceLine y={threshold} stroke={C.goldDeep} strokeDasharray="5 5" strokeWidth={1.25} />
            <ReferenceLine y={0} stroke={C.clay} strokeOpacity={0.6} />
            {lines.map((l) => (
              <Line key={l.key} type="linear" dataKey={l.key} stroke={l.color} strokeWidth={l.key === 'baseline' ? 2 : 2.5}
                strokeDasharray={l.dash} dot={false} activeDot={{ r: 4 }} isAnimationActive />
            ))}
            {lows?.map((p, i) => p && (
              <ReferenceDot key={i} x={p.day} y={p.balance} r={5} fill={p.balance < 0 ? C.clay : p.color} stroke="#fff" strokeWidth={2} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {active ? (
        <div className={`mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ${active.riskLevel === 'high' ? 'bg-clay-soft' : active.riskLevel === 'medium' ? 'bg-gold-soft' : 'bg-sage-soft'}`}>
          {active.riskLevel === 'low' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-sage" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-clay-deep" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{active.label}</span>
              <span className={`chip ${risk.cls}`}>{risk.label}</span>
            </div>
            <p className="mt-0.5 text-forest/80">{active.headline}</p>
            {compared && scenarios.length > 1 && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {scenarios.map((s) => (
                  <div key={s.id} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                    <div className="font-semibold">{money(s.amount)} {s.type}</div>
                    <div className="num text-forest/70">Lowest {money(s.scenario.lowest.balance)} on {shortDate(s.scenario.lowest.date)} · <span className={RISK[s.riskLevel].cls.split(' ')[1]}>{RISK[s.riskLevel].label}</span></div>
                  </div>
                ))}
              </div>
            )}
            {creditOnly && <p className="mt-1 text-xs text-forest/60">Card purchases don't change checking until the statement is paid.</p>}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-forest/70">
          Lowest projected balance: <span className="num font-semibold">{money(overview.forecast.lowest.balance)}</span> on {shortDate(overview.forecast.lowest.date)}. Ask MoneyCall about a transfer or purchase to see its impact here.
        </p>
      )}
    </section>
  );
}

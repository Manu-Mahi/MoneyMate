import { startOfToday, addDays, addMonths, iso, parseISO, daysBetween, round2, money, fmtDate, uid } from '../lib/util.js';
import { primaryChecking } from './bank.js';

export const HORIZON = 30;

// Builds the list of known money events for each of the next `days` days:
// paychecks, recurring bills (monthly), and average discretionary spending.
export function buildTimeline(snap, days = HORIZON) {
  const today = startOfToday();
  const timeline = Array.from({ length: days + 1 }, (_, t) => ({
    day: t, date: iso(addDays(today, t)), events: [],
  }));

  // Paychecks
  const { user } = snap;
  if (user.nextPayDate && user.payAmount) {
    let t = daysBetween(today, parseISO(user.nextPayDate));
    while (t <= days) {
      if (t >= 0) timeline[t].events.push({ kind: 'income', label: 'Paycheck', amount: user.payAmount });
      t += user.payFrequencyDays || 14;
    }
  }

  // Bills, repeating monthly
  const checking = primaryChecking(snap);
  for (const bill of snap.bills) {
    if (bill.accountId && checking && bill.accountId !== checking.id) continue;
    let due = parseISO(bill.dueDate);
    while (daysBetween(today, due) < 0) due = addMonths(due, 1);
    let t = daysBetween(today, due);
    while (t <= days) {
      timeline[t].events.push({ kind: 'bill', label: bill.payee, amount: -bill.amount, billId: bill.id, category: bill.category });
      due = addMonths(due, 1);
      t = daysBetween(today, due);
    }
  }
  return timeline;
}

// Effect of an action on the checking account (the account bills come from).
function checkingDelta(snap, action) {
  const chk = primaryChecking(snap);
  if (!chk) return 0;
  if (action.type === 'transfer') {
    if (action.fromId === chk.id) return -action.amount;
    if (action.toId === chk.id) return action.amount;
    return 0;
  }
  if (action.type === 'purchase') return action.accountId === chk.id ? -action.amount : 0;
  return 0;
}

// Day-by-day projection of the checking balance.
export function project(snap, actions = [], days = HORIZON) {
  const chk = primaryChecking(snap);
  const threshold = snap.user.safetyThreshold ?? 100;
  const timeline = buildTimeline(snap, days);
  let bal = chk ? chk.balance : 0;
  const series = [];

  for (const slot of timeline) {
    const events = [...slot.events];
    for (const a of actions) {
      if ((a.day ?? 0) === slot.day) {
        const delta = checkingDelta(snap, a);
        if (delta !== 0) events.unshift({ kind: 'action', label: a.label, amount: delta });
      }
    }
    if (slot.day >= 1 && snap.user.dailySpend) {
      events.push({ kind: 'spend', label: 'Everyday spending (avg)', amount: -snap.user.dailySpend });
    }
    for (const e of events) bal += e.amount;
    series.push({
      day: slot.day,
      date: slot.date,
      balance: round2(bal),
      events: events.filter((e) => e.kind !== 'spend').map((e) => ({ label: e.label, amount: round2(e.amount), kind: e.kind })),
    });
  }
  return { series, ...analyze(series, threshold) };
}

export function analyze(series, threshold) {
  let lowest = series[0];
  for (const p of series) if (p.balance < lowest.balance) lowest = p;
  const negative = series.filter((p) => p.balance < 0);
  const below = series.filter((p) => p.balance < threshold);
  const billsAtRisk = [];
  for (const p of negative) {
    for (const e of p.events) if (e.kind === 'bill') billsAtRisk.push({ label: e.label, amount: -e.amount, date: p.date });
  }
  const riskLevel = negative.length ? 'high' : below.length ? 'medium' : 'low';
  return {
    lowest: { balance: lowest.balance, day: lowest.day, date: lowest.date },
    firstShortfall: negative[0] ? { date: negative[0].date, balance: negative[0].balance } : null,
    shortfallDays: negative.length,
    belowThresholdDays: below.length,
    billsAtRisk,
    riskLevel,
    threshold,
    endBalance: series[series.length - 1].balance,
  };
}

// Largest amount that can leave checking today while the projected balance
// stays at or above the safety threshold for the whole horizon.
export function safeToSpend(snap) {
  const base = project(snap);
  const threshold = snap.user.safetyThreshold ?? 100;
  const amount = Math.max(0, Math.floor((base.lowest.balance - threshold) / 10) * 10);
  return {
    amount,
    threshold,
    lowestDate: base.lowest.date,
    lowestBalance: base.lowest.balance,
    nextPayDate: snap.user.nextPayDate,
    explanation:
      amount > 0
        ? `Spending up to ${money(amount)} today still keeps checking above ${money(threshold)} through ${fmtDate(base.series.at(-1).date)}. Tightest day: ${fmtDate(base.lowest.date)}.`
        : `Checking is already projected to dip below ${money(threshold)} on ${fmtDate(base.lowest.date)}. Avoid new spending until your paycheck on ${fmtDate(snap.user.nextPayDate)}.`,
  };
}

function headlineFor(sc) {
  const { action, scenario: s, safeAmount, threshold } = sc;
  if (sc.channel === 'credit') {
    return s.utilizationAfter > 100
      ? `This would exceed your ${money(sc.limit)} card limit.`
      : `Card utilization rises to ${s.utilizationAfter}%${s.utilizationAfter > 30 ? ', above the 30% guideline that protects your credit score' : ''}. Interest at ${sc.apr}% APR applies if not paid in full.`;
  }
  if (s.riskLevel === 'high') {
    const bill = s.billsAtRisk[0];
    const payee = bill ? bill.label.split(' · ')[0].toLowerCase() : '';
    return `This would drop checking to ${money(s.firstShortfall.balance)} on ${fmtDate(s.firstShortfall.date)}${bill ? `, when your ${money(bill.amount)} ${payee} is due` : ''}.`;
  }
  if (s.riskLevel === 'medium') {
    return `Checking stays positive but dips to ${money(s.lowest.balance)} on ${fmtDate(s.lowest.date)}, below your ${money(threshold)} cushion.`;
  }
  return `Looks safe: lowest projected checking balance is ${money(s.lowest.balance)} on ${fmtDate(s.lowest.date)}.`;
}

// Runs one what-if action against the baseline.
export function simulate(snap, action) {
  const base = project(snap);
  const threshold = snap.user.safetyThreshold ?? 100;
  const scen = project(snap, [action]);
  const delta = checkingDelta(snap, action);

  const sc = {
    id: uid('s'),
    type: action.type,
    action: { ...action, day: action.day ?? 0 },
    label: action.label,
    amount: action.amount,
    threshold,
    channel: delta !== 0 ? 'checking' : action.type === 'purchase' ? 'credit' : 'other',
    baseline: { series: base.series.map(({ day, date, balance }) => ({ day, date, balance })), lowest: base.lowest, riskLevel: base.riskLevel },
    scenario: { ...scen, series: scen.series },
    createdAt: new Date().toISOString(),
  };

  // Safe alternative amount only makes sense when the action drains checking.
  sc.safeAmount = delta < 0 ? Math.max(0, Math.floor((base.lowest.balance - threshold) / 10) * 10) : null;

  const from = snap.accounts.find((a) => a.id === action.fromId);
  const to = snap.accounts.find((a) => a.id === action.toId);
  sc.impacts = {};
  if (action.type === 'transfer' && from && to) {
    sc.impacts.fromAfter = round2(from.balance - action.amount);
    sc.impacts.toAfter = round2(to.kind === 'liability' ? to.balance - action.amount : to.balance + action.amount);
    sc.from = { id: from.id, nickname: from.nickname, mask: from.mask };
    sc.to = { id: to.id, nickname: to.nickname, mask: to.mask };
  }

  if (sc.channel === 'credit') {
    const card = snap.accounts.find((a) => a.id === action.accountId);
    sc.limit = card.limit;
    sc.apr = card.apr;
    const util = Math.round(((card.balance + action.amount) / card.limit) * 100);
    sc.scenario.utilizationBefore = Math.round((card.balance / card.limit) * 100);
    sc.scenario.utilizationAfter = util;
    sc.scenario.riskLevel = util > 100 ? 'high' : util > 30 ? 'medium' : 'low';
  }
  sc.riskLevel = sc.scenario.riskLevel;
  sc.headline = headlineFor(sc);
  return sc;
}

// Compact version for the language model: no daily series.
export function summarizeScenario(sc) {
  return {
    scenario_id: sc.id,
    label: sc.label,
    amount: sc.amount,
    risk_level: sc.riskLevel,
    headline: sc.headline,
    lowest_projected_checking: sc.scenario.lowest,
    baseline_lowest_checking: sc.baseline.lowest,
    first_shortfall: sc.scenario.firstShortfall,
    bills_at_risk: sc.scenario.billsAtRisk.slice(0, 3),
    safe_alternative_amount: sc.safeAmount,
    safety_threshold: sc.threshold,
    balances_after: sc.impacts,
    card_utilization_after_pct: sc.scenario.utilizationAfter,
  };
}

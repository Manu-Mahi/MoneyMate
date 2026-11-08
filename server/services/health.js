import { round2, money } from '../lib/util.js';

// 360° financial health: five indicators plus a 0–100 score.
// Thresholds are illustrative guidelines, not financial advice.

const STATUS_POINTS = { good: 100, watch: 65, risk: 30 };

export function monthlyFigures(snap) {
  const { user, bills } = snap;
  const income = round2((user.payAmount || 0) * (365 / (user.payFrequencyDays || 14)) / 12);
  const billTotal = round2(bills.reduce((s, b) => s + b.amount, 0));
  const discretionary = round2((user.dailySpend || 0) * 30.4);
  const debtPayments = round2(bills.filter((b) => b.category === 'debt').reduce((s, b) => s + b.amount, 0));
  const expenses = round2(billTotal + discretionary);
  return { income, bills: billTotal, discretionary, expenses, debtPayments, surplus: round2(income - expenses) };
}

export function netWorth(snap) {
  const assets = round2(snap.accounts.filter((a) => a.kind === 'asset').reduce((s, a) => s + a.balance, 0));
  const liabilities = round2(snap.accounts.filter((a) => a.kind === 'liability').reduce((s, a) => s + a.balance, 0));
  const liquid = round2(snap.accounts.filter((a) => a.type === 'checking' || a.type === 'savings').reduce((s, a) => s + a.balance, 0));
  return { assets, liabilities, net: round2(assets - liabilities), liquid };
}

export function computeHealth(snap) {
  const m = monthlyFigures(snap);
  const nw = netWorth(snap);
  const $ = (n) => money(Math.round(n));
  const cards = snap.accounts.filter((a) => a.type === 'credit_card');
  const cardBal = cards.reduce((s, a) => s + a.balance, 0);
  const cardLimit = cards.reduce((s, a) => s + (a.limit || 0), 0);

  const runway = m.expenses > 0 ? nw.liquid / m.expenses : 0;
  const debtBurden = m.income > 0 ? (m.debtPayments / m.income) * 100 : 0;
  const savingsRate = m.income > 0 ? (m.surplus / m.income) * 100 : 0;
  const utilization = cardLimit > 0 ? (cardBal / cardLimit) * 100 : 0;
  const debtToAssets = nw.assets > 0 ? (nw.liabilities / nw.assets) * 100 : 100;

  const indicators = [
    {
      key: 'cashRunway',
      label: 'Cash Runway',
      value: round2(runway),
      display: `${runway.toFixed(1)} mo`,
      status: runway >= 3 ? 'good' : runway >= 1 ? 'watch' : 'risk',
      explain: `Checking + savings (${$(nw.liquid)}) would cover ${runway.toFixed(1)} months of expenses (${$(m.expenses)}/mo). Aim for 3+.`,
    },
    {
      key: 'debtBurden',
      label: 'Debt Burden',
      value: round2(debtBurden),
      display: `${debtBurden.toFixed(0)}%`,
      status: debtBurden < 20 ? 'good' : debtBurden <= 36 ? 'watch' : 'risk',
      explain: `${$(m.debtPayments)} of your ${$(m.income)} monthly income goes to debt payments. Under 20% is comfortable; over 36% is strained.`,
    },
    {
      key: 'savingsRate',
      label: 'Savings Rate',
      value: round2(savingsRate),
      display: `${savingsRate.toFixed(0)}%`,
      status: savingsRate >= 20 ? 'good' : savingsRate >= 5 ? 'watch' : 'risk',
      explain: `After bills and everyday spending, about ${$(Math.max(0, m.surplus))} a month is left to save. 20%+ is a strong habit.`,
    },
    {
      key: 'creditUtilization',
      label: 'Credit Utilization',
      value: round2(utilization),
      display: `${utilization.toFixed(0)}%`,
      status: utilization < 30 ? 'good' : utilization <= 50 ? 'watch' : 'risk',
      explain: `${$(cardBal)} owed on ${$(cardLimit)} of card limits. Staying under 30% helps your credit score.`,
    },
    {
      key: 'debtToAssets',
      label: 'Debt-to-Assets',
      value: round2(debtToAssets),
      display: `${debtToAssets.toFixed(0)}%`,
      status: debtToAssets < 50 ? 'good' : debtToAssets <= 100 ? 'watch' : 'risk',
      explain: `You owe ${$(nw.liabilities)} against ${$(nw.assets)} in assets (net worth ${$(nw.net)}).`,
    },
  ];

  const weights = { cashRunway: 0.25, debtBurden: 0.2, savingsRate: 0.2, creditUtilization: 0.15, debtToAssets: 0.2 };
  const score = Math.round(indicators.reduce((s, i) => s + STATUS_POINTS[i.status] * weights[i.key], 0));
  const grade = score >= 80 ? 'Strong' : score >= 60 ? 'Steady' : score >= 40 ? 'Stretched' : 'At risk';
  const weakest = indicators.filter((i) => i.status !== 'good').sort((a, b) => STATUS_POINTS[a.status] - STATUS_POINTS[b.status])[0];

  return {
    score,
    grade,
    indicators,
    monthly: m,
    netWorth: nw,
    focus: weakest
      ? { key: weakest.key, label: weakest.label, tip: tipFor(weakest.key, m, nw) }
      : { key: null, label: 'All indicators healthy', tip: 'Keep your cushion and consider raising automatic savings.' },
  };
}

function tipFor(key, m, nw) {
  switch (key) {
    case 'cashRunway': {
      const target = Math.round(m.expenses * 3 / 100) * 100;
      const monthly = Math.max(50, Math.round((m.surplus * 0.5) / 10) * 10);
      return `Build toward a 3-month cushion (${money(target)}). Saving ${money(monthly)} a month closes the gap in about ${Math.max(1, Math.ceil((target - nw.liquid) / monthly))} months.`;
    }
    case 'debtBurden':
      return 'Pay extra on the highest-APR debt first; it lowers both burden and interest.';
    case 'savingsRate':
      return 'Trim one subscription and automate a transfer on payday so saving happens first.';
    case 'creditUtilization':
      return 'Paying the card down below 30% of its limit is the fastest credit-score win.';
    case 'debtToAssets':
      return 'Your retirement and CD balances help; keep paying loans on schedule and avoid new debt.';
    default:
      return '';
  }
}

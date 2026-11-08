export function money(n, { cents = false, sign = false } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(n);
  const showCents = cents || Math.abs(abs - Math.round(abs)) > 0.004;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 });
  return `${neg ? '−' : sign ? '+' : ''}$${s}`;
}

export function compact(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? '−' : ''}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return money(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function relDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export const ACCOUNT_LABEL = {
  checking: 'Checking', savings: 'Savings', credit_card: 'Credit card', cd: 'Certificate of deposit',
  ira: 'Retirement (IRA)', auto_loan: 'Auto loan', student_loan: 'Student loan', mortgage: 'Mortgage',
  business_loan: 'Business loan', loan: 'Loan',
};

export const RISK = {
  low: { label: 'Safe', cls: 'bg-sage-soft text-sage', dot: 'bg-sage' },
  medium: { label: 'Tight', cls: 'bg-gold-soft text-gold-deep', dot: 'bg-gold-deep' },
  high: { label: 'Risky', cls: 'bg-clay-soft text-clay-deep', dot: 'bg-clay' },
};

export const STATUS = {
  good: { label: 'Healthy', cls: 'bg-sage-soft text-sage', bar: 'bg-sage' },
  watch: { label: 'Watch', cls: 'bg-gold-soft text-gold-deep', bar: 'bg-gold-deep' },
  risk: { label: 'At risk', cls: 'bg-clay-soft text-clay-deep', bar: 'bg-clay' },
};

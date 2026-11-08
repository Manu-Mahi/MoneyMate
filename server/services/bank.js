import config, { hasNessie } from '../config.js';
import { nessie, isMoneyCallRecord, recordId } from './nessie.js';
import { buildDemoData } from '../data/demoData.js';
import { startOfToday, addDays, addMonths, iso, parseISO, daysBetween, round2, uid } from '../lib/util.js';

// The bank layer: one normalized snapshot of the user's money,
// sourced from Nessie when configured, otherwise from synthetic demo data.
// Linked accounts Nessie doesn't model (CDs, IRAs, student loans) come
// from the synthetic profile and are labelled as such.

let state = null;
let loading = null;

const NESSIE_TYPE = { Checking: 'checking', Savings: 'savings', 'Credit Card': 'credit_card' };
const LOAN_TYPE = {
  auto: 'auto_loan', home: 'mortgage', mortgage: 'mortgage', 'small business': 'business_loan',
  business: 'business_loan', student: 'student_loan', personal: 'loan',
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextOccurrence(dayOfMonth, today) {
  let d = new Date(today.getFullYear(), today.getMonth(), Math.min(dayOfMonth, 28));
  if (d < today) d = addMonths(d, 1);
  return iso(d);
}

// Roll a recurring date forward month by month until it is today or later.
function rollForward(dateStr, today) {
  let d = parseISO(dateStr);
  let guard = 0;
  while (daysBetween(today, d) < 0 && guard++ < 120) d = addMonths(d, 1);
  return iso(d);
}

function categorize(text) {
  const t = String(text || '').toLowerCase();
  if (/payroll|salary|paycheck|direct dep|income/.test(t)) return 'income';
  if (/transfer|moved to|brokerage/.test(t)) return 'transfer';
  if (/rent|mortgage|apartment|housing/.test(t)) return 'housing';
  if (/loan|autopay|financial services|servicing|credit card|card payment/.test(t)) return 'debt';
  if (/grocer|market|kroger|whole foods|trader/.test(t)) return 'groceries';
  if (/coffee|cafe|restaurant|dining|pizza|burger|doordash|uber eats/.test(t)) return 'dining';
  if (/gas|fuel|shell|exxon|transit|uber|lyft|parking/.test(t)) return 'transport';
  if (/electric|water|internet|phone|mobile|utility|utilities|insurance/.test(t)) return 'utilities';
  if (/netflix|spotify|hulu|subscription|gym|membership/.test(t)) return 'subscription';
  if (/pharmacy|doctor|dental|health|clinic/.test(t)) return 'health';
  return 'shopping';
}

// Estimate paycheck size and cadence from payroll-like deposits.
function inferPaycheck(deposits, today) {
  const pay = deposits
    .filter((d) => d.status !== 'cancelled' && Number(d.amount) > 0)
    .filter((d) => /payroll|salary|paycheck|direct dep/i.test(d.description || ''))
    .map((d) => ({ date: String(d.transaction_date || '').slice(0, 10), amount: Number(d.amount) }))
    .filter((d) => DATE_RE.test(d.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pay.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < pay.length; i++) gaps.push(daysBetween(parseISO(pay[i - 1].date), parseISO(pay[i].date)));
  gaps.sort((a, b) => a - b);
  const freq = Math.min(31, Math.max(7, gaps[Math.floor(gaps.length / 2)] || 14));
  let next = parseISO(pay.at(-1).date);
  let guard = 0;
  while (daysBetween(today, next) < 0 && guard++ < 60) next = addDays(next, freq);
  return { payAmount: pay.at(-1).amount, payFrequencyDays: freq, nextPayDate: iso(next) };
}

// Average everyday spend per day from recent small purchases/withdrawals.
function inferDailySpend(transactions, bills, today) {
  const billWords = bills.map((b) => b.payee.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
  const recent = transactions.filter((t) => {
    if (t.amount >= 0 || Math.abs(t.amount) >= 300) return false;
    if (['transfer', 'debt', 'housing'].includes(t.category)) return false;
    const age = daysBetween(parseISO(t.date), today);
    if (age < 0 || age > 60) return false;
    const d = t.description.toLowerCase();
    return !billWords.some((words) => words.some((w) => d.includes(w)));
  });
  if (recent.length < 5) return null;
  const span = Math.max(7, Math.min(60, Math.max(...recent.map((t) => daysBetween(parseISO(t.date), today)))));
  const total = recent.reduce((s, t) => s + Math.abs(t.amount), 0);
  return Math.min(150, Math.max(5, round2(total / span)));
}

async function loadFromNessie() {
  const today = startOfToday();
  const demo = buildDemoData(today);
  const cid = config.nessie.customerId;

  const [customer, rawAccounts] = await Promise.all([
    nessie.customer(cid).catch(() => null),
    nessie.customerAccounts(cid),
  ]);
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    throw new Error('Nessie customer has no accounts: run `npm run seed` first');
  }

  const accounts = [];
  const bills = [];
  const transactions = [];
  const allDeposits = [];

  for (const a of rawAccounts) {
    const type = NESSIE_TYPE[a.type] || 'checking';
    const acct = {
      id: a._id,
      type,
      nickname: a.nickname || a.type,
      mask: String(a.account_number || a._id).slice(-4),
      balance: Number(a.balance || 0),
      kind: type === 'credit_card' ? 'liability' : 'asset',
      source: 'nessie',
    };
    if (type === 'credit_card') { acct.limit = 5000; acct.apr = 22.9; }
    accounts.push(acct);

    const [b, p, dep, wd, tr, loans] = await Promise.all([
      nessie.bills(a._id).catch(() => []),
      nessie.purchases(a._id).catch(() => []),
      nessie.deposits(a._id).catch(() => []),
      nessie.withdrawals(a._id).catch(() => []),
      nessie.transfers(a._id).catch(() => []),
      nessie.loans(a._id).catch(() => []),
    ]);
    allDeposits.push(...dep);

    // The sandbox stores transactions but never changes balances, so replay
    // the records MoneyCall itself wrote (confirmed transfers) on top of the
    // stored balance. Everything else stays exactly as Nessie reports it.
    for (const x of tr) {
      if (x.status !== 'completed') continue;
      if (isMoneyCallRecord(x)) acct.balance = round2(acct.balance - Number(x.amount || 0));
      transactions.push({
        id: recordId(x), accountId: a._id, date: String(x.transaction_date || iso(today)).slice(0, 10),
        description: String(x.description || 'Transfer').replace(/\s*\[[a-z]+:[^\]]+\]/g, ''), amount: -Number(x.amount || 0), category: 'transfer',
        ...(isMoneyCallRecord(x) ? { via: 'MoneyCall' } : {}),
      });
    }
    for (const x of dep) {
      if (x.status === 'completed' && isMoneyCallRecord(x)) {
        acct.balance = round2(acct.kind === 'liability' ? acct.balance - Number(x.amount || 0) : acct.balance + Number(x.amount || 0));
      }
    }

    for (const bill of b) {
      if (bill.status === 'completed' || bill.status === 'cancelled') continue;
      const recurring = bill.recurring_date != null || bill.status === 'recurring';
      let dueDate = null;
      if (bill.upcoming_payment_date) dueDate = String(bill.upcoming_payment_date).slice(0, 10);
      else if (bill.payment_date) dueDate = String(bill.payment_date).slice(0, 10);
      else if (bill.recurring_date != null) dueDate = nextOccurrence(Number(bill.recurring_date), today);
      if (!dueDate || !DATE_RE.test(dueDate)) continue;
      if (daysBetween(today, parseISO(dueDate)) < 0) {
        if (!recurring) continue; // stale one-off bill
        dueDate = rollForward(dueDate, today);
      }
      const nick = String(bill.nickname || bill.payee || 'Bill');
      const cat = categorize(`${nick} ${bill.payee || ''}`);
      bills.push({
        id: recordId(bill),
        payee: nick,
        amount: Number(bill.payment_amount || 0),
        dueDate,
        category: cat === 'shopping' || cat === 'income' ? 'utilities' : cat,
        accountId: a._id,
        recurring,
      });
    }
    for (const x of p) {
      if (x.status === 'cancelled') continue;
      transactions.push({
        id: recordId(x), accountId: a._id, date: String(x.purchase_date || iso(today)).slice(0, 10),
        description: x.description || 'Purchase', amount: -Number(x.amount || 0), category: categorize(x.description),
      });
    }
    for (const x of dep) {
      if (x.status === 'cancelled') continue;
      const mc = isMoneyCallRecord(x);
      const cat = mc ? 'transfer' : categorize(x.description);
      transactions.push({
        id: recordId(x), accountId: a._id, date: String(x.transaction_date || iso(today)).slice(0, 10),
        description: String(x.description || 'Deposit').replace(/\s*\[[a-z]+:[^\]]+\]/g, ''), amount: Number(x.amount || 0), category: cat === 'shopping' ? 'income' : cat,
        ...(mc ? { via: 'MoneyCall' } : {}),
      });
    }
    for (const x of wd) {
      if (x.status === 'cancelled') continue;
      transactions.push({
        id: recordId(x), accountId: a._id, date: String(x.transaction_date || iso(today)).slice(0, 10),
        description: x.description || 'Withdrawal', amount: -Number(x.amount || 0), category: categorize(x.description),
      });
    }
    for (const loan of loans) {
      if (loan.status === 'declined' || loan.status === 'closed') continue;
      accounts.push({
        id: recordId(loan),
        type: LOAN_TYPE[String(loan.type || '').toLowerCase()] || 'loan',
        nickname: loan.description || `${loan.type || 'Personal'} loan`,
        mask: String(loan._id).slice(-4),
        balance: Number(loan.amount || 0),
        monthlyPayment: Number(loan.monthly_payment || 0),
        creditScore: loan.credit_score,
        kind: 'liability',
        source: 'nessie',
      });
    }
  }

  const checking = accounts.find((x) => x.type === 'checking');

  // Loans with a monthly payment but no matching bill: keep the payment in the forecast.
  for (const loan of accounts.filter((x) => x.kind === 'liability' && x.monthlyPayment > 0 && x.source === 'nessie')) {
    const words = loan.nickname.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    const covered = bills.some((b) => words.some((w) => b.payee.toLowerCase().includes(w)) || Math.abs(b.amount - loan.monthlyPayment) < 0.01);
    if (!covered && checking) {
      bills.push({
        id: `loan-${loan.id}`, payee: `${loan.nickname} payment`, amount: loan.monthlyPayment,
        dueDate: nextOccurrence(15, today), category: 'debt', accountId: checking.id, linkedAccountId: loan.id, recurring: true,
      });
    }
  }

  // Accounts Nessie doesn't model: CDs, IRAs, student loans (linked/synthetic).
  for (const extra of demo.accounts.filter((x) => x.source === 'linked')) {
    accounts.push({ ...extra });
  }
  // Keep the student loan payment in the forecast.
  bills.push(...demo.bills.filter((b) => b.linkedAccountId === 'student').map((b) => ({
    ...b, accountId: checking?.id,
  })));

  transactions.sort((x, y) => (x.date < y.date ? 1 : -1));

  const paycheck = inferPaycheck(allDeposits, today);
  const dailySpend = inferDailySpend(transactions, bills, today);
  const user = {
    ...demo.user,
    ...(paycheck || {}),
    dailySpend: dailySpend ?? demo.user.dailySpend,
    id: cid,
    name: customer ? `${customer.first_name} ${customer.last_name}` : demo.user.name,
    email: customer ? `${String(customer.first_name).toLowerCase()}@example.com` : demo.user.email,
    nessieCustomerId: cid,
    inferred: { paycheck: Boolean(paycheck), dailySpend: dailySpend != null },
  };

  return { user, accounts, bills, transactions, source: 'nessie' };
}

async function load() {
  if (hasNessie()) {
    try {
      const snap = await loadFromNessie();
      console.log(`[bank] loaded ${snap.accounts.length} accounts, ${snap.bills.length} bills, ${snap.transactions.length} transactions from Nessie`);
      return snap;
    } catch (err) {
      console.warn(`[bank] Nessie unavailable, using synthetic data: ${err.message}`);
      return { ...buildDemoData(), source: 'synthetic', sourceNote: 'Nessie unreachable: synthetic fallback' };
    }
  }
  return { ...buildDemoData(), source: 'synthetic' };
}

export async function getSnapshot() {
  if (state) return state;
  if (!loading) loading = load().then((s) => { state = s; loading = null; return s; });
  return loading;
}

export async function resetSnapshot() {
  state = null;
  return getSnapshot();
}

export function findAccount(snap, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase().trim();
  const exact = snap.accounts.find((a) => a.id === ref);
  if (exact) return exact;
  const aliases = {
    checking: ['checking', 'chk', 'everyday', 'current', 'operating'],
    savings: ['saving', 'sav', 'high-yield', 'hysa', 'emergency', 'fund'],
    credit_card: ['credit', 'card', 'cc', 'visa', 'rewards'],
    auto_loan: ['auto', 'car loan'],
    student_loan: ['student'],
    business_loan: ['business loan'],
    cd: ['cd', 'certificate'],
    ira: ['ira', 'retirement', 'roth'],
    mortgage: ['mortgage', 'home loan'],
  };
  for (const [type, words] of Object.entries(aliases)) {
    if (words.some((w) => r.includes(w))) {
      const acct = snap.accounts.find((a) => a.type === type);
      if (acct) return acct;
    }
  }
  return snap.accounts.find((a) => a.nickname.toLowerCase().includes(r)) || null;
}

export function primaryChecking(snap) {
  return snap.accounts.find((a) => a.type === 'checking');
}

// Moves money between two accounts the user owns. For a liability destination
// (card or loan) the transfer is a payment and reduces what is owed.
// When both accounts live in Nessie the transfer is also written there; if
// Nessie rejects it the local snapshot still updates and the record carries a
// syncNote so the demo never stalls on a sandbox hiccup.
export async function executeTransfer({ fromId, toId, amount, description }) {
  const snap = await getSnapshot();
  const from = snap.accounts.find((a) => a.id === fromId);
  const to = snap.accounts.find((a) => a.id === toId);
  if (!from || !to) throw Object.assign(new Error('Unknown account'), { status: 400 });
  if (from.kind !== 'asset') throw Object.assign(new Error('Transfers must come from a cash account'), { status: 400 });
  if (!(amount > 0)) throw Object.assign(new Error('Amount must be greater than zero'), { status: 400 });
  if (from.balance < amount) throw Object.assign(new Error(`Insufficient funds in ${from.nickname}`), { status: 400 });

  let nessieTransferId = null;
  let syncNote = null;
  if (snap.source === 'nessie' && from.source === 'nessie' && to.source === 'nessie') {
    try {
      const res = await nessie.createTransfer(from.id, {
        toAccountId: to.id, toNickname: to.nickname, fromNickname: from.nickname, amount,
        description: String(description || 'Transfer').replace(/^MoneyCall:\s*/, ''), date: iso(startOfToday()),
      });
      nessieTransferId = res.transferId;
      if (Math.round(amount) !== amount) syncNote = `Nessie stores whole dollars: recorded as $${Math.round(amount)}`;
    } catch (err) {
      console.warn(`[bank] Nessie transfer failed, applied locally: ${err.message}`);
      syncNote = `Recorded locally; Nessie rejected the write (${err.status || 'network'})`;
    }
  }

  from.balance = round2(from.balance - amount);
  to.balance = round2(to.kind === 'liability' ? to.balance - amount : to.balance + amount);

  const today = iso(startOfToday());
  const label = description || `Transfer to ${to.nickname}`;
  snap.transactions.unshift(
    { id: uid('t'), accountId: from.id, date: today, description: label, amount: -amount, category: 'transfer', via: 'MoneyCall' },
    { id: uid('t'), accountId: to.id, date: today, description: `Transfer from ${from.nickname}`, amount, category: 'transfer', via: 'MoneyCall' },
  );

  return { from, to, amount, nessieTransferId, syncNote };
}

// Demo reset in Nessie mode: delete the transfer/deposit records MoneyCall
// wrote, so balances return to what the seed created. Seed data is untouched.
export async function resetNessieDemo() {
  const snap = await getSnapshot();
  if (snap.source !== 'nessie') return { removed: 0 };
  let removed = 0;
  for (const a of snap.accounts.filter((x) => x.source === 'nessie' && (x.kind !== 'liability' || x.type === 'credit_card'))) {
    const [tr, dep] = await Promise.all([nessie.transfers(a.id).catch(() => []), nessie.deposits(a.id).catch(() => [])]);
    for (const t of tr.filter(isMoneyCallRecord)) await nessie.deleteTransfer(recordId(t)).then(() => removed++).catch(() => {});
    for (const d of dep.filter(isMoneyCallRecord)) await nessie.deleteDeposit(recordId(d)).then(() => removed++).catch(() => {});
  }
  if (removed) console.log(`[bank] demo reset removed ${removed} MoneyCall record(s) from Nessie`);
  return { removed };
}

export function daysUntil(dateStr) {
  return daysBetween(startOfToday(), parseISO(dateStr));
}

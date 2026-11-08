import config, { hasNessie } from '../config.js';
import { nessie } from './nessie.js';
import { buildDemoData } from '../data/demoData.js';
import { startOfToday, addMonths, iso, parseISO, daysBetween, round2, uid } from '../lib/util.js';

// The bank layer: one normalized snapshot of the user's money,
// sourced from Nessie when configured, otherwise from synthetic demo data.
// Linked accounts Nessie doesn't model (CDs, IRAs, student loans) come
// from the synthetic profile and are labelled as such.

let state = null;
let loading = null;

const NESSIE_TYPE = { Checking: 'checking', Savings: 'savings', 'Credit Card': 'credit_card' };
const LOAN_TYPE = { auto: 'auto_loan', home: 'mortgage', 'small business': 'business_loan' };

function nextOccurrence(dayOfMonth, today) {
  let d = new Date(today.getFullYear(), today.getMonth(), Math.min(dayOfMonth, 28));
  if (d < today) d = addMonths(d, 1);
  return iso(d);
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
    throw new Error('Nessie customer has no accounts — run `npm run seed` first');
  }

  const accounts = [];
  const bills = [];
  const transactions = [];

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
    if (type === 'credit_card') acct.limit = 5000;
    accounts.push(acct);

    const [b, p, dep, loans] = await Promise.all([
      nessie.bills(a._id).catch(() => []),
      nessie.purchases(a._id).catch(() => []),
      nessie.deposits(a._id).catch(() => []),
      nessie.loans(a._id).catch(() => []),
    ]);

    for (const bill of b || []) {
      if (bill.status === 'completed' || bill.status === 'cancelled') continue;
      const dueDate = bill.payment_date
        ? iso(parseISO(bill.payment_date))
        : bill.recurring_date
          ? nextOccurrence(Number(bill.recurring_date), today)
          : null;
      if (!dueDate) continue;
      const nick = String(bill.nickname || bill.payee || 'Bill');
      bills.push({
        id: bill._id,
        payee: nick,
        amount: Number(bill.payment_amount || 0),
        dueDate,
        category: /loan|card|debt/i.test(nick) ? 'debt' : /rent|mortgage/i.test(nick) ? 'housing' : 'utilities',
        accountId: a._id,
      });
    }
    for (const x of p || []) {
      transactions.push({
        id: x._id, accountId: a._id, date: String(x.purchase_date || iso(today)).slice(0, 10),
        description: x.description || 'Purchase', amount: -Number(x.amount || 0), category: 'shopping',
      });
    }
    for (const x of dep || []) {
      transactions.push({
        id: x._id, accountId: a._id, date: String(x.transaction_date || iso(today)).slice(0, 10),
        description: x.description || 'Deposit', amount: Number(x.amount || 0), category: 'income',
      });
    }
    for (const loan of loans || []) {
      accounts.push({
        id: loan._id,
        type: LOAN_TYPE[loan.type] || 'loan',
        nickname: loan.description || `${loan.type} loan`,
        mask: String(loan._id).slice(-4),
        balance: Number(loan.amount || 0),
        monthlyPayment: Number(loan.monthly_payment || 0),
        kind: 'liability',
        source: 'nessie',
      });
    }
  }

  // Accounts Nessie doesn't model: CDs, IRAs, student loans (linked/synthetic).
  for (const extra of demo.accounts.filter((x) => x.source === 'linked')) {
    accounts.push({ ...extra });
  }
  // Keep the student loan payment in the forecast.
  bills.push(...demo.bills.filter((b) => b.linkedAccountId === 'student').map((b) => ({
    ...b, accountId: accounts.find((x) => x.type === 'checking')?.id,
  })));

  transactions.sort((x, y) => (x.date < y.date ? 1 : -1));

  const user = {
    ...demo.user,
    name: customer ? `${customer.first_name} ${customer.last_name}` : demo.user.name,
    nessieCustomerId: cid,
  };

  return { user, accounts, bills, transactions, source: 'nessie' };
}

async function load() {
  if (hasNessie()) {
    try {
      const snap = await loadFromNessie();
      console.log(`[bank] loaded ${snap.accounts.length} accounts from Nessie`);
      return snap;
    } catch (err) {
      console.warn(`[bank] Nessie unavailable, using synthetic data: ${err.message}`);
      return { ...buildDemoData(), source: 'synthetic', sourceNote: 'Nessie unreachable — synthetic fallback' };
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
    checking: ['checking', 'chk', 'everyday', 'current'],
    savings: ['saving', 'sav', 'high-yield', 'hysa', 'emergency'],
    credit_card: ['credit', 'card', 'cc', 'visa', 'rewards'],
    auto_loan: ['auto', 'car'],
    student_loan: ['student'],
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
export async function executeTransfer({ fromId, toId, amount, description }) {
  const snap = await getSnapshot();
  const from = snap.accounts.find((a) => a.id === fromId);
  const to = snap.accounts.find((a) => a.id === toId);
  if (!from || !to) throw Object.assign(new Error('Unknown account'), { status: 400 });
  if (from.kind !== 'asset') throw Object.assign(new Error('Transfers must come from a cash account'), { status: 400 });
  if (!(amount > 0)) throw Object.assign(new Error('Amount must be greater than zero'), { status: 400 });
  if (from.balance < amount) throw Object.assign(new Error(`Insufficient funds in ${from.nickname}`), { status: 400 });

  let nessieTransferId = null;
  if (snap.source === 'nessie' && from.source === 'nessie' && to.source === 'nessie') {
    const res = await nessie.createTransfer(from.id, {
      toAccountId: to.id, amount, description: description || 'MoneyCall transfer', date: iso(startOfToday()),
    });
    nessieTransferId = res?.objectCreated?._id || null;
  }

  from.balance = round2(from.balance - amount);
  to.balance = round2(to.kind === 'liability' ? to.balance - amount : to.balance + amount);

  const today = iso(startOfToday());
  const label = description || `Transfer to ${to.nickname}`;
  snap.transactions.unshift(
    { id: uid('t'), accountId: from.id, date: today, description: label, amount: -amount, category: 'transfer', via: 'MoneyCall' },
    { id: uid('t'), accountId: to.id, date: today, description: `Transfer from ${from.nickname}`, amount, category: 'transfer', via: 'MoneyCall' },
  );

  return { from, to, amount, nessieTransferId };
}

export function daysUntil(dateStr) {
  return daysBetween(startOfToday(), parseISO(dateStr));
}

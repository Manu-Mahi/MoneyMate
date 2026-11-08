// Seeds the demo customer in Capital One's Nessie sandbox:
// checking, savings and a credit card, monthly bills, an auto loan,
// payroll deposits and a grocery purchase.
//
//   cd server && npm run seed              # creates Alex Morgan, prints NESSIE_CUSTOMER_ID
//   npm run seed                            # with NESSIE_CUSTOMER_ID set and that customer empty: fills it in
//   npm run seed -- --force                 # always create a fresh customer
import config from '../config.js';
import { nessie, createdId } from '../services/nessie.js';
import { buildDemoData } from '../data/demoData.js';

if (!config.nessie.key) {
  console.error('Set NESSIE_API_KEY in server/.env first (sign in at https://nessieisreal.com).');
  process.exit(1);
}
await nessie.customers().catch((e) => { console.error('Nessie rejected the key:', e.message); process.exit(1); });

const force = process.argv.includes('--force');
let customerId = null;

if (config.nessie.customerId && !force) {
  const existing = await nessie.customerAccounts(config.nessie.customerId).catch(() => null);
  if (existing === null) {
    console.warn(`NESSIE_CUSTOMER_ID ${config.nessie.customerId} was not found under this key; creating a new customer.`);
  } else if (existing.length > 0) {
    console.error(`Customer ${config.nessie.customerId} already has ${existing.length} account(s). Run \`npm run nessie:check\` to inspect it, or \`npm run seed -- --force\` to create another demo customer.`);
    process.exit(1);
  } else {
    customerId = config.nessie.customerId;
    console.log(`Customer ${customerId} exists but has no accounts; seeding into it.`);
  }
}

const demo = buildDemoData();
const acct = (n) => String(Math.floor(1e15 + Math.random() * 9e15)).slice(0, 12) + n;

if (!customerId) {
  const customer = await nessie.post('/customers', {
    first_name: 'Alex',
    last_name: 'Morgan',
    address: { street_number: '214', street_name: 'Maple Court', city: 'McKinney', state: 'TX', zip: '75069' },
  });
  customerId = createdId(customer);
  console.log('customer', customerId);
}

const ids = {};
for (const a of demo.accounts.filter((x) => ['checking', 'savings', 'credit_card'].includes(x.type))) {
  const type = { checking: 'Checking', savings: 'Savings', credit_card: 'Credit Card' }[a.type];
  const r = await nessie.post(`/customers/${customerId}/accounts`, {
    type, nickname: a.nickname, rewards: a.type === 'credit_card' ? 120 : 0, balance: a.balance, account_number: acct(a.mask),
  });
  ids[a.type] = createdId(r);
  console.log(type, ids[a.type]);
}

let billCount = 0;
for (const b of demo.bills.filter((x) => x.linkedAccountId !== 'student')) {
  await nessie.post(`/accounts/${ids.checking}/bills`, {
    status: 'pending',
    payee: b.payee,
    nickname: b.payee,
    payment_date: b.dueDate,
    recurring_date: Number(b.dueDate.slice(8, 10)),
    payment_amount: b.amount,
  }).then(() => billCount++).catch((e) => console.warn(`bill ${b.payee} skipped:`, e.message));
}
console.log(`bills: ${billCount}`);

await nessie.post(`/accounts/${ids.checking}/loans`, {
  type: 'auto', status: 'approved', credit_score: 712, monthly_payment: 385, amount: 14200, description: 'Auto Loan',
}).then(() => console.log('auto loan created')).catch((e) => console.warn('loan skipped:', e.message));

const merchant = await nessie.post('/merchants', {
  name: 'FreshMart', category: ['groceries'],
  address: { street_number: '100', street_name: 'Main St', city: 'McKinney', state: 'TX', zip: '75069' },
  geocode: { lat: 33.1972, lng: -96.6398 },
}).catch(() => null);

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
if (createdId(merchant)) {
  await nessie.post(`/accounts/${ids.checking}/purchases`, {
    merchant_id: createdId(merchant), medium: 'balance', purchase_date: daysAgo(2), amount: 85, status: 'completed', description: 'Groceries · FreshMart',
  }).catch((e) => console.warn('purchase skipped:', e.message));
}
// Two payroll deposits let MoneyCall infer the paycheck cadence from Nessie itself.
for (const d of [16, 2]) {
  await nessie.post(`/accounts/${ids.checking}/deposits`, {
    medium: 'balance', transaction_date: daysAgo(d), status: 'completed', amount: 2000, description: 'Payroll · Brightline Logistics',
  }).catch((e) => console.warn('deposit skipped:', e.message));
}

const after = await nessie.customerAccounts(customerId).catch(() => []);
console.log('\nBalances now in Nessie:');
for (const a of after) console.log(`  ${a.type.padEnd(12)} ${a.nickname.padEnd(24)} $${a.balance}`);
console.log(`\nDone (${today}). Make sure server/.env has:\n`);
console.log(`NESSIE_CUSTOMER_ID=${customerId}\nUSE_SYNTHETIC_DATA=false\n`);
console.log('Nessie may apply the sample deposits and purchase to balances; `npm run nessie:check` shows what MoneyCall will load.');

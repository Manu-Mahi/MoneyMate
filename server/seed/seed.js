// Creates the demo customer in Capital One's Nessie sandbox:
// checking, savings and a credit card, monthly bills, an auto loan,
// a salary deposit and a few purchases. Prints the customer id to put in
// NESSIE_CUSTOMER_ID.
//
//   cd server && npm run seed
import config from '../config.js';
import { nessie } from '../services/nessie.js';
import { buildDemoData } from '../data/demoData.js';

if (!config.nessie.key) {
  console.error('Set NESSIE_API_KEY in server/.env first (get one at http://api.nessieisreal.com).');
  process.exit(1);
}

const demo = buildDemoData();
const acct = (n) => String(Math.floor(1e15 + Math.random() * 9e15)).slice(0, 12) + n;

const created = (r) => r?.objectCreated?._id;

const customer = await nessie.post('/customers', {
  first_name: 'Alex',
  last_name: 'Morgan',
  address: { street_number: '214', street_name: 'Maple Court', city: 'McKinney', state: 'TX', zip: '75069' },
});
const customerId = created(customer);
console.log('customer', customerId);

const ids = {};
for (const a of demo.accounts.filter((x) => ['checking', 'savings', 'credit_card'].includes(x.type))) {
  const type = { checking: 'Checking', savings: 'Savings', credit_card: 'Credit Card' }[a.type];
  const r = await nessie.post(`/customers/${customerId}/accounts`, {
    type, nickname: a.nickname, rewards: a.type === 'credit_card' ? 120 : 0, balance: a.balance, account_number: acct(a.mask),
  });
  ids[a.type] = created(r);
  console.log(type, ids[a.type]);
}

for (const b of demo.bills.filter((x) => x.linkedAccountId !== 'student')) {
  await nessie.post(`/accounts/${ids.checking}/bills`, {
    status: 'pending',
    payee: b.payee,
    nickname: b.payee,
    payment_date: b.dueDate,
    recurring_date: Number(b.dueDate.slice(8, 10)),
    payment_amount: b.amount,
  });
}
console.log(`bills: ${demo.bills.length - 1}`);

await nessie.post(`/accounts/${ids.checking}/loans`, {
  type: 'auto', status: 'approved', credit_score: 712, monthly_payment: 385, amount: 14200, description: 'Auto Loan',
}).then(() => console.log('auto loan created')).catch((e) => console.warn('loan skipped:', e.message));

const merchant = await nessie.post('/merchants', {
  name: 'FreshMart', category: ['groceries'],
  address: { street_number: '100', street_name: 'Main St', city: 'McKinney', state: 'TX', zip: '75069' },
  geocode: { lat: 33.1972, lng: -96.6398 },
}).catch(() => null);

const today = new Date().toISOString().slice(0, 10);
if (created(merchant)) {
  await nessie.post(`/accounts/${ids.checking}/purchases`, {
    merchant_id: created(merchant), medium: 'balance', purchase_date: today, amount: 85, status: 'completed', description: 'Groceries · FreshMart',
  }).catch((e) => console.warn('purchase skipped:', e.message));
}
await nessie.post(`/accounts/${ids.checking}/deposits`, {
  medium: 'balance', transaction_date: today, status: 'completed', amount: 2000, description: 'Salary Deposit · Brightline',
}).catch((e) => console.warn('deposit skipped:', e.message));

console.log('\nDone. Add this to server/.env:\n');
console.log(`NESSIE_CUSTOMER_ID=${customerId}\n`);
console.log('Note: Nessie may apply the sample deposit and purchase to balances; check them in the dashboard.');

// Verifies the Nessie key and customer in server/.env and prints what MoneyCall
// will load from them.
//   cd server && npm run nessie:check
import config, { hasNessie } from '../config.js';
import { nessie } from '../services/nessie.js';
import { getSnapshot } from '../services/bank.js';

if (!config.nessie.key) {
  console.error('NESSIE_API_KEY is empty. Sign in at https://nessieisreal.com, copy your key into server/.env, then run `npm run seed`.');
  process.exit(1);
}
console.log(`Nessie base: ${config.nessie.base}`);
const customers = await nessie.customers().catch((e) => { console.error('Key check failed:', e.message); process.exit(1); });
console.log(`Key OK. ${customers.length} customer(s) belong to this key.`);
for (const c of customers) console.log(`  ${c._id}  ${c.first_name} ${c.last_name}`);

if (!config.nessie.customerId) {
  console.log(customers.length
    ? '\nSet NESSIE_CUSTOMER_ID to one of the ids above (or run `npm run seed` to create the demo customer).'
    : '\nNo customers yet: run `npm run seed` to create the demo customer, then paste the printed id into NESSIE_CUSTOMER_ID.');
  process.exit(0);
}
if (config.useSynthetic) console.warn('USE_SYNTHETIC_DATA=true: the app will ignore Nessie until you set it to false.');
if (!hasNessie()) process.exit(0);

const snap = await getSnapshot();
console.log(`\nLoaded from: ${snap.source}${snap.sourceNote ? ` (${snap.sourceNote})` : ''}`);
console.log(`User: ${snap.user.name} · paycheck $${snap.user.payAmount} every ${snap.user.payFrequencyDays} days (next ${snap.user.nextPayDate})${snap.user.inferred?.paycheck ? ' [inferred from deposits]' : ''}`);
console.log(`Everyday spend: $${snap.user.dailySpend}/day${snap.user.inferred?.dailySpend ? ' [inferred from purchases]' : ''}`);
console.log('Accounts:');
for (const a of snap.accounts) console.log(`  ${a.type.padEnd(13)} ${a.nickname.padEnd(40)} $${a.balance}${a.kind === 'liability' ? ' owed' : ''}  [${a.source}]`);
console.log(`Bills in forecast: ${snap.bills.length}`);
for (const b of snap.bills) console.log(`  ${b.dueDate}  ${b.payee.padEnd(40)} $${b.amount}`);
console.log(`Transactions: ${snap.transactions.length} (latest ${snap.transactions[0]?.date || 'n/a'})`);

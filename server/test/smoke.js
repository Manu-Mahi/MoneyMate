// End-to-end smoke test of the judge demo script against the local engine.
//   cd server && npm test
process.env.GEMINI_API_KEY = '';
process.env.USE_SYNTHETIC_DATA = 'true';
process.env.MONGODB_URI = '';

const { createApp } = await import('../index.js');
const app = await createApp();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());

try {
  const ov = await get('/overview');
  check(ov.accounts.length >= 7, `overview has ${ov.accounts.length} accounts (checking, savings, card, CD, IRA, loans)`);
  check(ov.health.indicators.length >= 3, `health has ${ov.health.indicators.length} indicators, score ${ov.health.score}`);
  check(ov.forecast.series.length === 31, '30-day forecast');
  console.log('      safe to spend:', ov.safeToSpend.amount, '| lowest baseline:', ov.forecast.lowest);

  let r = await post('/chat', { message: 'How much money do I have?' });
  const cid = r.conversationId;
  console.log('  >', r.reply);
  check(/\$2,500/.test(r.reply) && /\$1,000/.test(r.reply), 'balance answer');

  r = await post('/chat', { conversationId: cid, message: 'Transfer $1,000 to my savings' });
  console.log('  >', r.reply);
  check(r.ui.scenarios[0]?.riskLevel === 'high', 'big transfer flagged high risk');
  check(!r.ui.pending, 'no pending transaction for a risky transfer');

  r = await post('/chat', { conversationId: cid, message: 'What if I transfer only $300?' });
  console.log('  >', r.reply);
  check(r.ui.compared && r.ui.scenarios.length === 2, 'what-if compares two scenarios');
  check(r.ui.scenarios[1].riskLevel === 'low', '$300 is low risk');

  r = await post('/chat', { conversationId: cid, message: 'Okay, transfer $300' });
  console.log('  >', r.reply);
  check(Boolean(r.ui.pending?._id), 'pending transaction created');

  const c = await post(`/transactions/${r.ui.pending._id}/confirm`);
  console.log('  >', c.message);
  const chk = c.overview.accounts.find((a) => a.type === 'checking');
  const sav = c.overview.accounts.find((a) => a.type === 'savings');
  check(chk.balance === 2200 && sav.balance === 1300, 'balances updated to $2,200 / $1,300');

  const again = await post(`/transactions/${r.ui.pending._id}/confirm`);
  check(Boolean(again.error), 'double-confirm rejected');

  r = await post('/chat', { conversationId: cid, message: 'Can I afford a $600 laptop?' });
  console.log('  >', r.reply);
  check(r.ui.scenarios.length >= 1, 'purchase simulated');

  r = await post('/chat', { conversationId: cid, message: 'How healthy are my finances?' });
  console.log('  >', r.reply);
  r = await post('/chat', { conversationId: cid, message: 'How much can I safely spend before payday?' });
  console.log('  >', r.reply);
  r = await post('/chat', { conversationId: cid, message: 'What bills are coming up?' });
  console.log('  >', r.reply);
  r = await post('/chat', { conversationId: cid, message: 'Pay $200 toward my credit card' });
  console.log('  >', r.reply);

  const sc = await get('/scenarios');
  check(sc.scenarios.length >= 4, `scenarios saved (${sc.scenarios.length})`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

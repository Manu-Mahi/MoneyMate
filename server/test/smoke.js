// End-to-end smoke test of the judge demo script against the local engine,
// plus the text/phone channel flow and the Photon webhook contract.
//   cd server && npm test
// Set SMOKE_MONGODB_URI to run the same checks against a MongoDB instance.
process.env.GEMINI_API_KEY = '';
process.env.USE_SYNTHETIC_DATA = 'true';
process.env.MONGODB_URI = process.env.SMOKE_MONGODB_URI || '';
process.env.PHOTON_BASE_URL = 'http://127.0.0.1:9'; // never reach the real API from tests
process.env.PHOTON_PROJECT_ID = 'pho_prj_test';
process.env.PHOTON_API_KEY = 'pho_sk_test';
process.env.PHOTON_WEBHOOK_SECRET = 'whsec_' + Buffer.from('moneycall-smoke-secret-0123456789').toString('base64');
process.env.CHANNEL_SECRET = '';
process.env.TRANSFER_PIN = '4321';
process.env.PHOTON_PHONES = '';

const { createApp } = await import('../index.js');
const { signWebhook } = await import('../services/photon.js');
const store = await import('../services/store.js');
const app = await createApp();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const get = (p) => fetch(base + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log(`store: ${store.storeMode()}`);
  const st = await get('/status');
  check(st.ok && st.photon === true && st.photonWebhook === true, 'status reports services');

  const ov = await get('/overview');
  check(ov.accounts.length >= 7, `overview has ${ov.accounts.length} accounts (checking, savings, card, CD, IRA, loans)`);
  check(ov.health.indicators.length >= 3, `health has ${ov.health.indicators.length} indicators, score ${ov.health.score}`);
  check(ov.forecast.series.length === 31, '30-day forecast');
  console.log('      safe to spend:', ov.safeToSpend.amount, '| lowest baseline:', ov.forecast.lowest);

  // ---- Judge script on the web channel -----------------------------------
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
  check(/Press Confirm/.test(r.reply), 'web channel asks to press Confirm');

  const c = await post(`/transactions/${r.ui.pending._id}/confirm`);
  console.log('  >', c.message);
  const chk = c.overview.accounts.find((a) => a.type === 'checking');
  const sav = c.overview.accounts.find((a) => a.type === 'savings');
  check(chk.balance === 2200 && sav.balance === 1300, 'balances updated to $2,200 / $1,300');

  const again = await post(`/transactions/${r.ui.pending._id}/confirm`);
  check(again.status === 409 && Boolean(again.error), 'double-confirm rejected with 409');

  r = await post('/chat', { conversationId: cid, message: 'Can I afford a $600 laptop?' });
  console.log('  >', r.reply);
  check(r.ui.scenarios.length >= 1, 'purchase simulated');

  for (const q of ['How healthy are my finances?', 'How much can I safely spend before payday?', 'What bills are coming up?', 'Pay $200 toward my credit card']) {
    r = await post('/chat', { conversationId: cid, message: q });
    console.log('  >', r.reply);
  }

  const sc = await get('/scenarios');
  check(sc.scenarios.length >= 4, `scenarios saved (${sc.scenarios.length})`);
  const convs = await get('/conversations');
  check(convs.conversations.some((x) => x._id === cid && x.messageCount >= 10), 'conversation history listed');
  const conv = await get(`/conversations/${cid}`);
  check(conv.messages.length >= 10 && conv.messages.some((m) => m.pendingId), 'conversation stores messages with pending ids');

  // ---- Text channel (what Photon iMessage/SMS feeds) ---------------------
  const handle = '+15550100';
  r = await post('/channels/message', { channel: 'sms', handle, text: 'what is my balance' });
  console.log('  sms>', r.reply);
  check(/\$2,200/.test(r.reply), 'text channel reads live balance after the web transfer');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'move $10 to savings' });
  console.log('  sms>', r.reply, '|', r.confirmInstruction);
  check(Boolean(r.ui?.pending?._id) && /4-digit PIN/i.test(r.reply) && /PIN/.test(r.confirmInstruction || ''), 'text channel creates pending and asks for the PIN');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'maybe later' });
  console.log('  sms>', r.reply);
  check(!r.executed, 'unrelated text does not confirm');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'yes' });
  console.log('  sms>', r.reply);
  check(r.executed === false && r.awaitingPin === true && /PIN/.test(r.reply), '"yes" alone is not enough when a PIN is set');
  r = await post('/channels/message', { channel: 'sms', handle, text: '0000' });
  console.log('  sms>', r.reply);
  check(r.executed === false && /not correct/.test(r.reply) && r.pending?.status === 'pending', 'wrong PIN is rejected, transfer still pending');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'my pin is 4321' });
  console.log('  sms>', r.reply);
  check(r.executed === true && r.overview?.accounts.find((a) => a.type === 'checking').balance === 2190, 'correct PIN executes the pending transfer');
  const pc = await get(`/conversations/c_sms_+15550100`);
  check(pc.messages.some((m) => m.role === 'user' && /••••/.test(m.text)) && !pc.messages.some((m) => /4321/.test(m.text)), 'PIN is masked in the stored conversation');
  r = await post('/channels/message', { channel: 'sms', handle, text: '4321' });
  check(r.executed === false, 'a PIN with nothing pending does not confirm anything');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'send $5 to savings' });
  r = await post('/channels/message', { channel: 'sms', handle, text: 'no' });
  check(/Cancelled/.test(r.reply) && r.pending?.status === 'cancelled', 'texted "no" cancels');
  r = await post('/channels/message', { channel: 'sms', handle, text: 'send $5 to savings' });
  for (const bad of ['1111', '2222']) r = await post('/channels/message', { channel: 'sms', handle, text: bad });
  check(r.pending?.status === 'pending' && /1 attempt left/.test(r.reply), 'two wrong PINs leave one attempt');
  r = await post('/channels/message', { channel: 'sms', handle, text: '3333' });
  console.log('  sms>', r.reply);
  check(r.pending?.status === 'cancelled' && /cancelled for your security/.test(r.reply), 'third wrong PIN cancels the transfer');

  // ---- Photon webhook contract ------------------------------------------
  const event = {
    id: 'evt_smoke_1', type: 'message.received', apiVersion: '2026-07-01', source: 'sms.photon', timestamp: new Date().toISOString(),
    data: {
      projectId: 'pho_prj_test',
      object: {
        id: 'pho_msg_smoke1', platform: 'sms', status: 'received', createdAt: new Date().toISOString(),
        content: { type: 'text', format: 'plain', text: 'How much can I safely spend?' },
        space: { id: 'pho_spc_smoke', kind: 'direct', platform: 'sms' },
        sentBy: { id: 'pho_usr_human', handle: '+15550123', platform: 'sms' },
        receivedBy: { id: 'pho_usr_agent', handle: '+15550999', platform: 'sms' },
      },
    },
  };
  const raw = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = signWebhook({ secret: process.env.PHOTON_WEBHOOK_SECRET, id: 'wh_smoke_1', timestamp: ts, rawBody: raw });

  let w = await post('/photon/webhook', raw, { 'webhook-id': 'wh_smoke_1', 'webhook-timestamp': ts, 'webhook-signature': 'v1,AAAA' });
  check(w.status === 400, 'webhook with a bad signature is rejected');
  w = await post('/photon/webhook', raw, { 'webhook-id': 'wh_smoke_1', 'webhook-timestamp': String(Number(ts) - 3600), 'webhook-signature': sig });
  check(w.status === 400, 'webhook with a stale timestamp is rejected');
  w = await post('/photon/webhook', raw, { 'webhook-id': 'wh_smoke_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,BBBB ${sig}` });
  check(w.status === 202, 'signed webhook accepted (202)');
  w = await post('/photon/webhook', raw, { 'webhook-id': 'wh_smoke_1', 'webhook-timestamp': ts, 'webhook-signature': sig });
  check(w.status === 200 && w.duplicate === true, 'duplicate delivery is a no-op');
  await sleep(300); // async processing; the reply send fails (no real Photon) and is recorded
  const act = await get('/channels/activity');
  const ev = act.events.find((e) => e._id === 'wh_smoke_1');
  check(ev && ev.channel === 'sms' && ev.handle === '+15550123' && ev.text === 'How much can I safely spend?', 'webhook event recorded in the audit trail');
  check(ev && ev.status === 'failed' && /Photon/.test(ev.error || ''), 'reply attempt reached the Photon client (fails without real credentials)');
  const photonConv = await get('/conversations/c_photon_pho_spc_smoke');
  check(photonConv.messages?.length === 2 && photonConv.channel === 'sms', 'webhook text became a conversation keyed by the Photon space');

  // call event
  const callEvent = { id: 'evt_call', type: 'call.ended', apiVersion: '2026-07-01', source: 'voice.photon', timestamp: new Date().toISOString(),
    data: { projectId: 'pho_prj_test', object: { id: 'pho_call_1', platform: 'voice', status: 'ended', direction: 'inbound', caller: { handle: '+15550123' }, callee: { handle: '+15550999' }, dtmfInputs: [], timestamps: { startedAt: new Date(Date.now() - 65000).toISOString(), endedAt: new Date().toISOString() } } } };
  const rawCall = JSON.stringify(callEvent);
  const sigCall = signWebhook({ secret: process.env.PHOTON_WEBHOOK_SECRET, id: 'wh_call_1', timestamp: ts, rawBody: rawCall });
  w = await post('/photon/webhook', rawCall, { 'webhook-id': 'wh_call_1', 'webhook-timestamp': ts, 'webhook-signature': sigCall });
  await sleep(100);
  const act2 = await get('/channels/activity');
  const call = act2.events.find((e) => e._id === 'wh_call_1');
  check(w.status === 202 && call?.channel === 'voice' && /Call ended from \+15550123 after 6\ds/.test(call.text), 'call event logged');

  const audit = await get('/activity');
  check(audit.pending.filter((p) => p.status === 'executed').length === 2 && audit.pending.some((p) => p.channel === 'sms'), 'audit trail has both executed transfers with their channel');
  check(audit.pending.some((p) => p.status === 'cancelled' && p.pinAttempts === 2), 'audit trail records PIN attempts');
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await store.closeStore().catch(() => {});
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

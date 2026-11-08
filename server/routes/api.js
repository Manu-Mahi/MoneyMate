import { Router } from 'express';
import config, { hasGemini, hasNessie, hasPhoton } from '../config.js';
import { getSnapshot, resetSnapshot, resetNessieDemo, daysUntil } from '../services/bank.js';
import { project, safeToSpend } from '../services/simulator.js';
import { computeHealth } from '../services/health.js';
import { chat } from '../services/agent.js';
import { makeContext, runTool } from '../services/tools.js';
import { confirmPending, cancelPending } from '../services/transactions.js';
import { handleInbound } from '../services/channels.js';
import * as store from '../services/store.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function buildOverview() {
  const snap = await getSnapshot();
  const health = computeHealth(snap);
  const forecast = project(snap);
  const upcoming = snap.bills
    .map((b) => ({ ...b, inDays: daysUntil(b.dueDate) }))
    .filter((b) => b.inDays >= 0 && b.inDays <= 30)
    .sort((a, b) => a.inDays - b.inDays);
  return {
    user: snap.user,
    source: snap.source,
    sourceNote: snap.sourceNote || null,
    accounts: snap.accounts,
    bills: upcoming,
    transactions: snap.transactions.slice(0, 25),
    health,
    safeToSpend: safeToSpend(snap),
    forecast: {
      series: forecast.series,
      lowest: forecast.lowest,
      riskLevel: forecast.riskLevel,
      threshold: forecast.threshold,
      endBalance: forecast.endBalance,
    },
  };
}

router.get('/status', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({
    ok: true,
    gemini: hasGemini(),
    model: hasGemini() ? config.gemini.model : null,
    nessie: hasNessie(),
    nessieLive: snap.source === 'nessie',
    store: store.storeMode(),
    photon: hasPhoton(),
    photonWebhook: hasPhoton() && Boolean(config.photon.webhookSecret),
    publicUrl: config.publicUrl || null,
  });
}));

router.get('/overview', wrap(async (req, res) => res.json(await buildOverview())));

router.get('/accounts', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ accounts: snap.accounts, netWorth: computeHealth(snap).netWorth });
}));

router.get('/bills', wrap(async (req, res) => {
  const days = Number(req.query.days || 30);
  const snap = await getSnapshot();
  res.json({ bills: snap.bills.map((b) => ({ ...b, inDays: daysUntil(b.dueDate) })).filter((b) => b.inDays >= 0 && b.inDays <= days) });
}));

router.get('/transactions', wrap(async (req, res) => {
  const snap = await getSnapshot();
  const { accountId, limit = 50 } = req.query;
  res.json({ transactions: snap.transactions.filter((t) => !accountId || t.accountId === accountId).slice(0, Number(limit)) });
}));

router.get('/health', wrap(async (req, res) => res.json(computeHealth(await getSnapshot()))));

router.get('/forecast', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json(project(snap, [], Math.min(90, Number(req.query.days || 30))));
}));

// Direct what-if simulation from the Forecast page.
router.post('/simulate', wrap(async (req, res) => {
  const snap = await getSnapshot();
  const { type, amount, from, to, accountId, description } = req.body || {};
  const ctx = makeContext({ snap, conv: { _id: 'simulator', lastScenarioIds: [] }, userId: snap.user.id });
  const r = type === 'purchase'
    ? await runTool('simulate_purchase', { amount, description, account: accountId || 'checking' }, ctx)
    : await runTool('simulate_transfer', { from_account: from || 'checking', to_account: to || 'savings', amount }, ctx);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ scenario: ctx.ui.scenarios.at(-1) });
}));

router.post('/compare', wrap(async (req, res) => {
  const ids = req.body?.scenarioIds || [];
  const list = (await Promise.all(ids.map((id) => store.getScenario(id)))).filter(Boolean);
  res.json({ scenarios: list });
}));

router.post('/chat', wrap(async (req, res) => {
  const { conversationId, message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });
  res.json(await chat({ conversationId, message: String(message).slice(0, 1000), channel: 'web' }));
}));

// Channel-agnostic entry point: Photon texts, a phone voice agent (ElevenLabs
// tool call), or the "Text MoneyCall" demo card all post here. "yes"/"no"
// resolve the open pending transaction in that thread.
router.post('/channels/message', wrap(async (req, res) => {
  const { channel = 'text', handle = 'demo', text, message, conversationId } = req.body || {};
  // The in-app demo phone is as open as the rest of the web UI; the secret guards external callers (voice agents, scripts).
  if (config.channelSecret && channel !== 'sms-demo' && req.get('x-channel-secret') !== config.channelSecret) {
    return res.status(401).json({ error: 'Invalid channel secret' });
  }
  const body = String(text ?? message ?? '').trim();
  if (!body) return res.status(400).json({ error: 'text is required' });
  const r = await handleInbound({ channel: String(channel).slice(0, 30), handle: String(handle).slice(0, 60), text: body.slice(0, 1000), conversationId });
  if (r.executed) r.overview = await buildOverview();
  res.json(r);
}));

router.get('/channels/activity', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ events: await store.listEvents(snap.user.id, Number(req.query.limit || 30)) });
}));

router.post('/transactions/pending', wrap(async (req, res) => {
  const snap = await getSnapshot();
  const ctx = makeContext({ snap, conv: { _id: 'simulator', lastScenarioIds: [] }, userId: snap.user.id });
  const r = await runTool('create_pending_transaction', { scenario_id: req.body?.scenarioId }, ctx);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ pending: ctx.ui.pending });
}));

router.post('/transactions/:id/confirm', wrap(async (req, res) => {
  const snap = await getSnapshot();
  const { pending, message } = await confirmPending(req.params.id, { userId: snap.user.id });
  res.json({ pending, message, overview: await buildOverview() });
}));

router.post('/transactions/:id/cancel', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ pending: await cancelPending(req.params.id, { userId: snap.user.id }) });
}));

router.get('/scenarios', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ scenarios: await store.listScenarios(snap.user.id) });
}));

router.get('/activity', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ pending: await store.listPending(snap.user.id) });
}));

router.get('/conversations', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ conversations: await store.listConversations(snap.user.id) });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  res.json((await store.getConversation(req.params.id)) || { _id: req.params.id, messages: [] });
}));

// Restores the demo balances (synthetic mode) so the judge script can run again.
router.post('/demo/reset', wrap(async (req, res) => {
  await store.clearMemory();
  await resetNessieDemo();
  await resetSnapshot();
  res.json(await buildOverview());
}));

export default router;

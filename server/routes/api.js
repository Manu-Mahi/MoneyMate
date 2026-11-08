import { Router } from 'express';
import config, { hasGemini, hasNessie } from '../config.js';
import { getSnapshot, resetSnapshot, executeTransfer, findAccount, daysUntil } from '../services/bank.js';
import { project, simulate, safeToSpend } from '../services/simulator.js';
import { computeHealth } from '../services/health.js';
import { chat } from '../services/agent.js';
import { makeContext, runTool } from '../services/tools.js';
import * as store from '../services/store.js';
import { money } from '../lib/util.js';

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

router.get('/status', (req, res) => {
  res.json({
    ok: true,
    gemini: hasGemini(),
    model: hasGemini() ? config.gemini.model : null,
    nessie: hasNessie(),
    store: store.storeMode(),
  });
});

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
  res.json(await chat({ conversationId, message: String(message).slice(0, 1000) }));
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
  const p = await store.getPending(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pending transaction not found' });
  if (p.userId !== snap.user.id) return res.status(403).json({ error: 'Not your transaction' });
  if (p.status !== 'pending') return res.status(409).json({ error: `Transaction already ${p.status}` });
  if (new Date(p.expiresAt) < new Date()) {
    await store.updatePending(p._id, { status: 'expired' });
    return res.status(410).json({ error: 'This confirmation expired. Ask again to set it up.' });
  }
  const from = findAccount(snap, p.fromId);
  if (!from || from.balance < p.amount) return res.status(400).json({ error: 'Insufficient funds for this transfer now.' });

  const result = await executeTransfer({ fromId: p.fromId, toId: p.toId, amount: p.amount, description: `MoneyCall: ${p.label}` });
  const updated = await store.updatePending(p._id, {
    status: 'executed', executedAt: new Date(), nessieTransferId: result.nessieTransferId,
  });
  res.json({
    pending: updated,
    message: `Done. ${money(p.amount)} moved from ${result.from.nickname} to ${result.to.nickname}. ${result.from.nickname} now has ${money(result.from.balance)}.`,
    overview: await buildOverview(),
  });
}));

router.post('/transactions/:id/cancel', wrap(async (req, res) => {
  const p = await store.getPending(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pending transaction not found' });
  if (p.status !== 'pending') return res.status(409).json({ error: `Transaction already ${p.status}` });
  res.json({ pending: await store.updatePending(p._id, { status: 'cancelled' }) });
}));

router.get('/scenarios', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ scenarios: await store.listScenarios(snap.user.id) });
}));

router.get('/activity', wrap(async (req, res) => {
  const snap = await getSnapshot();
  res.json({ pending: await store.listPending(snap.user.id) });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  res.json((await store.getConversation(req.params.id)) || { _id: req.params.id, messages: [] });
}));

// Restores the demo balances (synthetic mode) so the judge script can run again.
router.post('/demo/reset', wrap(async (req, res) => {
  await store.clearMemory();
  await resetSnapshot();
  res.json(await buildOverview());
}));

export default router;

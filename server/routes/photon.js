import { Router } from 'express';
import config, { hasPhoton } from '../config.js';
import { photon, verifyWebhook, parseInboundMessage, parseCallEvent } from '../services/photon.js';
import { handleInbound } from '../services/channels.js';
import { getSnapshot } from '../services/bank.js';
import * as store from '../services/store.js';

// Photon inbound webhook: iMessage / SMS / WhatsApp texts become MoneyCall
// conversations; call events land in the audit trail. The handler verifies the
// Standard Webhooks signature against the raw body, acknowledges quickly, and
// processes the event asynchronously (Photon retries on non-2xx).

const router = Router();

router.post('/webhook', async (req, res) => {
  const id = req.get('webhook-id');
  const timestamp = req.get('webhook-timestamp');
  const signature = req.get('webhook-signature');
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});

  if (!config.photon.webhookSecret) {
    return res.status(503).json({ error: 'PHOTON_WEBHOOK_SECRET is not set' });
  }
  const v = verifyWebhook({ secret: config.photon.webhookSecret, id, timestamp, signature, rawBody });
  if (!v.ok) return res.status(400).json({ error: `Invalid webhook signature: ${v.reason}` });

  if (await store.hasEvent(id)) return res.status(200).json({ ok: true, duplicate: true });

  const event = req.body || {};
  const snap = await getSnapshot();
  const base = { _id: id, userId: snap.user.id, type: event.type, source: event.source, at: new Date(event.timestamp || Date.now()), status: 'received' };
  const inbound = parseInboundMessage(event);
  const call = parseCallEvent(event);
  await store.recordEvent({
    ...base,
    channel: inbound?.platform || (call ? 'voice' : String(event.source || 'photon').split('.')[0]),
    handle: inbound?.handle || call?.caller || null,
    text: inbound?.text || (call ? describeCall(call) : null),
    data: inbound || call || null,
  });

  // Ack now; Photon's delivery timeout is 20s and the chat loop may take longer.
  res.status(202).json({ ok: true });

  processEvent(event, id, inbound, call).catch((err) => {
    console.error('[photon] event processing failed:', err.message);
    store.updateEvent(id, { status: 'failed', error: err.message }).catch(() => {});
  });
});

function describeCall(c) {
  const who = c.caller ? ` from ${c.caller}` : '';
  switch (c.type) {
    case 'call.started': return `Incoming call${who}`;
    case 'call.answered': return `Call answered${who}`;
    case 'call.ended': return `Call ended${who}${c.durationSec != null ? ` after ${c.durationSec}s` : ''}`;
    case 'call.dtmf.received': return `Keypad input${who}: ${c.dtmf || '…'}`;
    default: return `${c.type}${who}`;
  }
}

async function processEvent(event, id, inbound, call) {
  if (inbound) {
    const r = await handleInbound({
      channel: inbound.platform || 'photon',
      handle: inbound.handle,
      text: inbound.text,
      conversationId: inbound.spaceId ? `c_photon_${inbound.spaceId}` : undefined,
    });
    let reply = r.reply;
    if (r.confirmInstruction && r.engine !== 'confirm') reply += ` ${r.confirmInstruction}`;
    await photon.sendText({
      spaceId: inbound.spaceId,
      senderId: inbound.agentUserId,
      parentMessageId: inbound.messageId,
      text: reply,
      idempotencyKey: `moneycall-reply:${inbound.messageId}`,
    });
    await store.updateEvent(id, { status: 'replied', reply, conversationId: r.conversationId, engine: r.engine, executed: r.executed, amount: r.pending?.amount });
    return;
  }
  if (call) {
    await store.updateEvent(id, { status: 'logged' });
    return;
  }
  await store.updateEvent(id, { status: 'ignored' });
}

// Lines, assignments and webhook destinations, for the setup page / script.
router.get('/lines', async (req, res, next) => {
  try {
    if (!hasPhoton()) return res.json({ configured: false, lines: [] });
    const [resources, assignments] = await Promise.all([
      photon.listResources({ state: 'active' }).catch((e) => ({ error: e.message, resources: [] })),
      photon.listImessageAssignments().catch(() => null),
    ]);
    res.json({
      configured: true,
      webhookSecret: Boolean(config.photon.webhookSecret),
      lines: (resources.resources || []).map((r) => ({ id: r.resourceId, type: r.type, abilities: r.abilities, state: r.state, detail: r.detail })),
      assignments: assignments?.assignments || assignments?.items || assignments || null,
      error: resources.error || null,
    });
  } catch (err) { next(err); }
});

export default router;

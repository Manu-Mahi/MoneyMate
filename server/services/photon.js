import crypto from 'node:crypto';
import config, { hasPhoton } from '../config.js';

// Photon (https://photon.codes): messaging + voice lines for agents.
// REST base https://api.photon.codes/v1, Bearer project API key (pho_sk_...).
// Inbound events arrive as Standard Webhooks (webhook-id / webhook-timestamp /
// webhook-signature headers, HMAC-SHA256 over `${id}.${timestamp}.${body}`).

const API = () => `${config.photon.base}/v1`;
const project = () => config.photon.projectId;

async function request(method, path, { body, headers = {}, timeoutMs = 15000 } = {}) {
  if (!hasPhoton()) throw Object.assign(new Error('Photon is not configured (PHOTON_PROJECT_ID / PHOTON_API_KEY)'), { status: 503 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    try {
      res = await fetch(`${API()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.photon.apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw Object.assign(new Error(`Photon ${method} ${path} failed: ${err.cause?.message || err.message}`), { status: 0 });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      // RFC 9457 problem document: { type, code, title, status, detail }
      const err = new Error(`Photon ${method} ${path} → ${res.status} ${data?.code || ''} ${data?.title || data?.detail || text || ''}`.trim());
      err.status = res.status;
      err.problem = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const qs = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const photon = {
  request,

  // Lines (phone numbers, iMessage handles) owned by the project.
  listResources: (params = { state: 'active' }) => request('GET', `/projects/${project()}/platforms/resources${qs(params)}`),

  // Messages — polling fallback when no webhook is reachable (local dev).
  listMessages: (params = {}) => request('GET', `/projects/${project()}/messages${qs(params)}`),
  getMessage: (messageId) => request('GET', `/projects/${project()}/messages/${messageId}`),

  // Reply in the same Space as an inbound message. senderId is the agent's user
  // id from the inbound message's receivedBy.id; spaceId is space.id.
  sendText: ({ spaceId, senderId, parentMessageId, text, idempotencyKey }) =>
    request('POST', `/projects/${project()}/messages`, {
      headers: { 'idempotency-key': idempotencyKey || `moneycall:${crypto.randomUUID()}` },
      body: {
        spaceId,
        senderId,
        ...(parentMessageId ? { parentMessageId } : {}),
        content: { type: 'text', format: 'plain', text: String(text).slice(0, 1500) },
      },
    }),

  setTyping: (spaceId, body) => request('POST', `/projects/${project()}/spaces/${spaceId}/typing`, { body }),

  // Shared iMessage line: Photon lends a number that only `handle` (the
  // tester's phone, E.164) can text. The human must text first.
  assignImessageLine: ({ handle, idempotencyKey }) =>
    request('POST', `/projects/${project()}/platforms/imessage/assignments`, {
      headers: { 'Idempotency-Key': idempotencyKey || `moneycall-imessage:${handle}` },
      body: { handle },
    }),
  listImessageAssignments: () => request('GET', `/projects/${project()}/platforms/imessage/assignments`),

  // Buy a US SMS number (needs an approved 10DLC campaign before it can send).
  purchaseSmsNumber: ({ areaCode, promotionCode, idempotencyKey }) =>
    request('POST', `/projects/${project()}/platforms/sms/numbers`, {
      headers: { 'Idempotency-Key': idempotencyKey || `moneycall-sms:${crypto.randomUUID()}` },
      body: { countryCode: 'US', ...(areaCode ? { areaCode } : {}), ...(promotionCode ? { promotionCode } : {}) },
    }),

  // Webhooks
  listWebhookApiVersions: () => request('GET', `/projects/${project()}/webhooks/api-versions`),
  listWebhookDestinations: () => request('GET', `/projects/${project()}/webhooks/destinations`),
  createWebhookDestination: ({ url, name = 'MoneyCall', events = DEFAULT_EVENTS, idempotencyKey }) =>
    request('POST', `/projects/${project()}/webhooks/destinations`, {
      headers: { 'Idempotency-Key': idempotencyKey || `moneycall-webhook:${url}` },
      body: { apiVersion: config.photon.apiVersion, name, url, enabledEvents: events, status: 'enabled', description: 'MoneyCall text & phone banking' },
    }),
  deleteWebhookDestination: (destinationId) => request('DELETE', `/projects/${project()}/webhooks/destinations/${destinationId}`),

  // Voice profiles (SIP routing to a voice-agent provider such as ElevenLabs).
  listVoiceProfiles: () => request('GET', `/projects/${project()}/platforms/voice/profiles`),
  getDefaultVoiceProfile: () => request('GET', `/projects/${project()}/platforms/voice/profiles/default`),
};

export const DEFAULT_EVENTS = ['message.received', 'call.started', 'call.answered', 'call.ended', 'call.dtmf.received'];

const normalizePhone = (p) => String(p || '').replace(/[^\d+]/g, '').replace(/^(?!\+)/, '+');

// Makes sure every phone in the list has a shared iMessage line, creating the
// missing ones. Returns [{ handle, assignedPhoneNumber, created }].
export async function ensurePhoneAssignments(phones = config.photon.phones) {
  const wanted = [...new Set(phones.map(normalizePhone).filter((p) => /^\+\d{8,15}$/.test(p)))];
  if (!wanted.length) return [];
  const existing = await photon.listImessageAssignments();
  const list = existing?.assignments || existing?.items || [];
  const out = [];
  for (const handle of wanted) {
    const have = list.find((a) => normalizePhone(a.handle) === handle);
    if (have) { out.push({ handle, assignedPhoneNumber: have.assignedPhoneNumber, created: false }); continue; }
    try {
      const a = await photon.assignImessageLine({ handle });
      out.push({ handle, assignedPhoneNumber: a.assignedPhoneNumber || a.assignment?.assignedPhoneNumber || null, created: true });
    } catch (err) {
      out.push({ handle, assignedPhoneNumber: null, created: false, error: err.message });
    }
  }
  return out;
}

export function logAssignments(rows) {
  if (!rows.length) return;
  console.log('[photon] iMessage lines (phone → number to text):');
  for (const r of rows) {
    console.log(`  ${r.handle.padEnd(15)} → ${r.assignedPhoneNumber || 'n/a'}${r.created ? '  (new)' : ''}${r.error ? `  FAILED: ${r.error}` : ''}`);
  }
}

// ---- Standard Webhooks signature -------------------------------------------

function secretBytes(secret) {
  const raw = String(secret || '').replace(/^whsec_/, '');
  return Buffer.from(raw, 'base64');
}

export function signWebhook({ secret, id, timestamp, rawBody }) {
  const mac = crypto.createHmac('sha256', secretBytes(secret));
  mac.update(`${id}.${timestamp}.${rawBody}`);
  return `v1,${mac.digest('base64')}`;
}

export function verifyWebhook({ secret, id, timestamp, signature, rawBody, toleranceSec = 300, now = Date.now() }) {
  if (!secret) return { ok: false, reason: 'no secret configured' };
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing webhook headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(now / 1000 - ts) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = signWebhook({ secret, id, timestamp, rawBody }).slice(3);
  const expectedBuf = Buffer.from(expected, 'base64');
  for (const part of String(signature).split(/\s+/)) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const got = Buffer.from(sig, 'base64');
    if (got.length === expectedBuf.length && crypto.timingSafeEqual(got, expectedBuf)) return { ok: true };
  }
  return { ok: false, reason: 'signature mismatch' };
}

// Normalizes an inbound Photon message event into what MoneyCall needs.
export function parseInboundMessage(event) {
  const msg = event?.data?.object;
  if (!msg || event?.type !== 'message.received') return null;
  if (msg.content?.type !== 'text' || !msg.content?.text) return null;
  return {
    messageId: msg.id,
    platform: msg.platform,
    text: msg.content.text,
    spaceId: msg.space?.id,
    agentUserId: msg.receivedBy?.id,
    handle: msg.sentBy?.handle || msg.sentBy?.id || msg.space?.id,
    agentHandle: msg.receivedBy?.handle,
    at: msg.createdAt || event.timestamp,
  };
}

export function parseCallEvent(event) {
  const call = event?.data?.object;
  if (!call || !String(event?.type || '').startsWith('call.')) return null;
  const t = call.timestamps || {};
  const started = t.startedAt || t.answeredAt || call.createdAt;
  const ended = t.endedAt;
  return {
    callId: call.id,
    type: event.type,
    direction: call.direction,
    status: call.status,
    caller: call.caller?.handle,
    callee: call.callee?.handle,
    dtmf: (call.dtmfInputs || []).map((d) => d.digit || d.key || d.value || '').join(''),
    durationSec: started && ended ? Math.max(0, Math.round((new Date(ended) - new Date(started)) / 1000)) : null,
    at: event.timestamp,
  };
}

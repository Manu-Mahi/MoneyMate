import config from '../config.js';
import { getSnapshot } from './bank.js';
import { chat } from './agent.js';
import { confirmPending, cancelPending, openPendingFor } from './transactions.js';
import * as store from './store.js';
import { money } from '../lib/util.js';

// One entry point for every non-web channel: Photon iMessage/SMS/WhatsApp,
// a phone voice agent, or a script. Conversations are keyed by channel +
// handle so a person texting from the same number keeps their context, and a
// decision ("yes", "no", or the 4-digit PIN) is bound to the specific pending
// transaction in that thread.

// A decision is a short message that starts with an affirmation or refusal
// and names no amount ("Yes, confirm" counts; "yes but make it $200" goes to the agent).
export const YES = /^\s*(yes|yeah|yep|yup|y|confirm|confirmed|do it|go ahead|approve|approved|proceed|ok(ay)? (confirm|do it|go ahead|proceed))\b/i;
export const NO = /^\s*(no|nope|n|cancel|stop|don'?t|do not|never ?mind|abort)\b/i;
export const PIN = /^\D*(\d{4})\D*$/;
export const isDecision = (m) => m.length <= 60 && !/[\d$]/.test(m);

export const slug = (s) => String(s || 'anon').toLowerCase().replace(/[^a-z0-9+]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function conversationIdFor(channel, handle) {
  return `c_${slug(channel)}_${slug(handle)}`;
}

// What the user must do to confirm on this channel; appended to replies that
// leave a transfer pending.
export function confirmInstruction(channel = 'text') {
  const voice = channel === 'voice';
  if (config.transferPin) return voice ? 'Say your 4-digit PIN to confirm, or say no to cancel.' : 'Reply with your 4-digit PIN to confirm, or NO to cancel.';
  return voice ? 'Say yes to confirm or no to cancel.' : 'Reply YES to confirm or NO to cancel.';
}

const samePin = (a, b) => a.length === b.length && [...a].every((c, i) => c === b[i]);

async function decide({ message, open, channel, snap }) {
  const pinGiven = PIN.exec(message)?.[1];

  if (NO.test(message) && isDecision(message)) {
    const pending = await cancelPending(open._id, { userId: snap.user.id });
    return { reply: 'Cancelled. Nothing was moved.', executed: false, pending, decided: true };
  }

  if (config.transferPin) {
    if (pinGiven) {
      if (samePin(pinGiven, config.transferPin)) {
        const r = await confirmPending(open._id, { userId: snap.user.id });
        return { reply: r.message, executed: true, pending: r.pending, decided: true };
      }
      const attempts = (open.pinAttempts || 0) + 1;
      if (attempts >= config.pinMaxAttempts) {
        const pending = await cancelPending(open._id, { userId: snap.user.id });
        return { reply: `That PIN is not correct. After ${attempts} attempts the ${money(open.amount)} transfer was cancelled for your security. Nothing was moved.`, executed: false, pending, decided: true };
      }
      const pending = await store.updatePending(open._id, { pinAttempts: attempts });
      return { reply: `That PIN is not correct. ${config.pinMaxAttempts - attempts} attempt${config.pinMaxAttempts - attempts === 1 ? '' : 's'} left. Reply with your 4-digit PIN, or NO to cancel.`, executed: false, pending, decided: true };
    }
    if (YES.test(message) && isDecision(message)) {
      return { reply: `For your security, ${channel === 'voice' ? 'say' : 'reply with'} your 4-digit PIN to move ${money(open.amount)}, or ${channel === 'voice' ? 'say' : 'reply'} NO to cancel.`, executed: false, pending: open, decided: true };
    }
    return null;
  }

  if (YES.test(message) && isDecision(message)) {
    const r = await confirmPending(open._id, { userId: snap.user.id });
    return { reply: r.message, executed: true, pending: r.pending, decided: true };
  }
  return null;
}

export async function handleInbound({ channel = 'text', handle, text, conversationId }) {
  const message = String(text || '').trim();
  if (!message) throw Object.assign(new Error('text is required'), { status: 400 });
  const snap = await getSnapshot();
  const id = conversationId || conversationIdFor(channel, handle);
  const conv = await store.getConversation(id);
  const open = await openPendingFor(conv);

  if (open) {
    let decision = null;
    try {
      decision = await decide({ message, open, channel, snap });
    } catch (err) {
      decision = { reply: err.message, executed: false, pending: null, decided: true };
    }
    if (decision) {
      const now = new Date();
      conv.messages.push({ role: 'user', text: message.replace(PIN, (m, p) => m.replace(p, '••••')), at: now, channel });
      conv.messages.push({ role: 'assistant', text: decision.reply, at: now, channel, executed: decision.executed, pendingId: decision.pending?.status === 'pending' ? decision.pending._id : undefined });
      conv.messages = conv.messages.slice(-60);
      await store.saveConversation(conv);
      const stillPending = decision.pending?.status === 'pending';
      return {
        conversationId: id, channel, handle, reply: decision.reply, executed: decision.executed, pending: decision.pending,
        engine: 'confirm', awaitingPin: stillPending && Boolean(config.transferPin),
        confirmInstruction: stillPending ? confirmInstruction(channel) : null,
      };
    }
  }

  const r = await chat({ conversationId: id, message, channel, handle });
  const pending = r.ui?.pending || null;
  return {
    ...r, channel, handle, executed: false, pending,
    awaitingPin: Boolean(pending && config.transferPin),
    confirmInstruction: pending ? confirmInstruction(channel) : null,
  };
}

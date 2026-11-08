import { hasGemini } from '../config.js';
import { getSnapshot } from './bank.js';
import { makeContext } from './tools.js';
import { geminiAgent } from './gemini.js';
import { localAgent } from './localAgent.js';
import * as store from './store.js';
import { uid } from '../lib/util.js';

// channel: 'web' (Confirm button in the UI) or a text/voice channel such as
// 'imessage', 'sms', 'whatsapp', 'voice'. Off the web the assistant asks the
// user to reply YES instead of pressing a button.
export async function chat({ conversationId, message, userId, channel = 'web', handle }) {
  const snap = await getSnapshot();
  userId = userId || snap.user.id;
  const id = conversationId || uid('c');
  const conv = (await store.getConversation(id)) || { _id: id, userId, channel, handle, messages: [], lastScenarioIds: [] };
  if (!conv.channel) conv.channel = channel;
  if (handle && !conv.handle) conv.handle = handle;
  const ctx = makeContext({ snap, conv, userId, channel });

  let reply;
  let engine = 'local';
  let note = null;
  if (hasGemini()) {
    try {
      reply = await geminiAgent(message, ctx);
      engine = 'gemini';
    } catch (err) {
      console.warn('[agent] Gemini failed, using local engine:', err.message);
      note = 'Gemini unavailable: answered by the local engine';
      // Reset UI side effects from a partial Gemini run.
      ctx.ui = { scenarios: [], comparison: null, pending: null };
      ctx.trace = [];
    }
  }
  if (!reply) reply = await localAgent(message, ctx);

  const now = new Date();
  conv.messages.push({ role: 'user', text: message, at: now, channel });
  conv.messages.push({
    role: 'assistant', text: reply, at: now, channel, engine,
    scenarioIds: ctx.ui.scenarios.map((s) => s.id),
    pendingId: ctx.ui.pending?._id,
  });
  conv.messages = conv.messages.slice(-60);
  await store.saveConversation(conv);

  return {
    conversationId: id,
    reply,
    engine,
    note,
    tools: ctx.trace,
    ui: {
      scenarios: ctx.ui.comparison || ctx.ui.scenarios.slice(-2),
      compared: Boolean(ctx.ui.comparison),
      pending: ctx.ui.pending,
    },
  };
}

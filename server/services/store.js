import mongoose from 'mongoose';
import config from '../config.js';

// Persistence for users, conversations, scenarios, pending transactions and
// channel events (Photon texts/calls). Uses MongoDB Atlas when MONGODB_URI is
// set, otherwise an in-memory store with the same interface so the app
// always runs.

let mode = 'memory';

const UserSchema = new mongoose.Schema(
  {
    _id: String,
    name: String,
    email: String,
    nessieCustomerId: String,
    safetyThreshold: Number,
    monthlyIncome: Number,
    payAmount: Number,
    payFrequencyDays: Number,
    nextPayDate: String,
    dailySpend: Number,
    source: String,
    lastSeenAt: Date,
  },
  { timestamps: true },
);

const ConversationSchema = new mongoose.Schema(
  {
    _id: String,
    userId: String,
    channel: String,
    handle: String,
    messages: [{ role: String, text: String, scenarioIds: [String], pendingId: String, channel: String, engine: String, executed: Boolean, at: Date }],
    lastScenarioIds: [String],
  },
  { timestamps: true },
);
ConversationSchema.index({ userId: 1, updatedAt: -1 });

const ScenarioSchema = new mongoose.Schema(
  {
    _id: String,
    userId: String,
    conversationId: String,
    type: String,
    label: String,
    amount: Number,
    riskLevel: String,
    headline: String,
    data: mongoose.Schema.Types.Mixed, // full scenario incl. daily series
  },
  { timestamps: true },
);
ScenarioSchema.index({ userId: 1, createdAt: -1 });

const PendingSchema = new mongoose.Schema(
  {
    _id: String,
    userId: String,
    scenarioId: String,
    fromId: String,
    toId: String,
    amount: Number,
    label: String,
    channel: String,
    status: { type: String, default: 'pending' },
    pinAttempts: { type: Number, default: 0 },
    expiresAt: Date,
    executedAt: Date,
    nessieTransferId: String,
    syncNote: String,
    summary: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);
// Audit trail: keep decided records, but drop never-confirmed ones a day after expiry.
PendingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400, partialFilterExpression: { status: 'pending' } });
PendingSchema.index({ userId: 1, createdAt: -1 });

// Inbound channel events (Photon webhooks). _id is the webhook-id, which makes
// duplicate deliveries a no-op.
const EventSchema = new mongoose.Schema(
  {
    _id: String,
    userId: String,
    type: String,
    source: String,
    channel: String,
    handle: String,
    text: String,
    reply: String,
    status: String,
    conversationId: String,
    engine: String,
    executed: Boolean,
    amount: Number,
    error: String,
    data: mongoose.Schema.Types.Mixed,
    at: Date,
  },
  { timestamps: true },
);
EventSchema.index({ userId: 1, at: -1 });

let User, Conversation, Scenario, Pending, Event;
const mem = { users: new Map(), conversations: new Map(), scenarios: new Map(), pending: new Map(), events: new Map() };

export async function initStore() {
  if (!config.mongoUri) {
    console.log('[store] MONGODB_URI not set: using in-memory store');
    return mode;
  }
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 6000 });
    User = mongoose.models.User || mongoose.model('User', UserSchema, 'users');
    Conversation = mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema, 'conversations');
    Scenario = mongoose.models.Scenario || mongoose.model('Scenario', ScenarioSchema, 'scenarios');
    Pending = mongoose.models.PendingTransaction || mongoose.model('PendingTransaction', PendingSchema, 'pendingTransactions');
    Event = mongoose.models.ChannelEvent || mongoose.model('ChannelEvent', EventSchema, 'channelEvents');
    await Promise.all([User, Conversation, Scenario, Pending, Event].map((m) => m.syncIndexes().catch(() => {})));
    mode = 'mongo';
    console.log(`[store] connected to MongoDB (${mongoose.connection.name})`);
  } catch (err) {
    console.warn(`[store] MongoDB connection failed, using memory: ${err.message}`);
  }
  return mode;
}

export async function closeStore() {
  if (mode === 'mongo') await mongoose.disconnect();
}

export const storeMode = () => mode;

const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
const withoutId = ({ _id, ...rest }) => rest;

// ---- users ---------------------------------------------------------------

export async function upsertUser(u) {
  const doc = { ...u, lastSeenAt: new Date() };
  if (mode === 'mongo') {
    await User.findByIdAndUpdate(u._id, { $set: withoutId(doc) }, { upsert: true });
    return doc;
  }
  mem.users.set(u._id, clone(doc));
  return doc;
}

export async function getUser(id) {
  if (mode === 'mongo') return User.findById(id).lean();
  return clone(mem.users.get(id)) || null;
}

// ---- conversations ---------------------------------------------------------

export async function getConversation(id) {
  if (mode === 'mongo') return (await Conversation.findById(id).lean()) || null;
  return clone(mem.conversations.get(id)) || null;
}

export async function saveConversation(conv) {
  if (mode === 'mongo') {
    await Conversation.findByIdAndUpdate(conv._id, { $set: withoutId(conv) }, { upsert: true });
    return conv;
  }
  mem.conversations.set(conv._id, clone({ ...conv, updatedAt: new Date() }));
  return conv;
}

export async function listConversations(userId, limit = 20) {
  const summarize = (c) => ({
    _id: c._id,
    channel: c.channel || 'web',
    handle: c.handle || null,
    messageCount: (c.messages || []).length,
    first: c.messages?.find((m) => m.role === 'user')?.text || '',
    last: c.messages?.at(-1)?.text || '',
    updatedAt: c.updatedAt || c.messages?.at(-1)?.at || null,
  });
  if (mode === 'mongo') {
    const docs = await Conversation.find({ userId }).sort({ updatedAt: -1 }).limit(limit).lean();
    return docs.map(summarize);
  }
  return [...mem.conversations.values()]
    .filter((c) => c.userId === userId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit)
    .map(summarize);
}

// ---- scenarios -------------------------------------------------------------

export async function saveScenario(sc, { userId, conversationId } = {}) {
  const doc = {
    _id: sc.id, userId, conversationId, type: sc.type, label: sc.label, amount: sc.amount,
    riskLevel: sc.riskLevel, headline: sc.headline, data: sc, createdAt: new Date(),
  };
  if (mode === 'mongo') await Scenario.create(doc);
  else mem.scenarios.set(sc.id, clone(doc));
  return sc;
}

export async function getScenario(id) {
  const doc = mode === 'mongo' ? await Scenario.findById(id).lean() : clone(mem.scenarios.get(id));
  return doc ? doc.data : null;
}

export async function listScenarios(userId, limit = 30) {
  if (mode === 'mongo') {
    const docs = await Scenario.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((d) => d.data);
  }
  return [...mem.scenarios.values()]
    .filter((d) => d.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((d) => d.data);
}

// ---- pending transactions -------------------------------------------------

export async function createPending(p) {
  if (mode === 'mongo') await Pending.create(p);
  else mem.pending.set(p._id, clone(p));
  return p;
}

export async function getPending(id) {
  if (mode === 'mongo') return Pending.findById(id).lean();
  const p = clone(mem.pending.get(id));
  if (p) p.expiresAt = new Date(p.expiresAt);
  return p;
}

export async function updatePending(id, patch) {
  if (mode === 'mongo') return Pending.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  const p = { ...mem.pending.get(id), ...clone(patch) };
  mem.pending.set(id, p);
  return clone(p);
}

export async function listPending(userId, limit = 20) {
  if (mode === 'mongo') return Pending.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return [...mem.pending.values()].filter((p) => p.userId === userId).reverse().slice(0, limit);
}

// ---- channel events (Photon) ----------------------------------------------

export async function hasEvent(id) {
  if (!id) return false;
  if (mode === 'mongo') return Boolean(await Event.exists({ _id: id }));
  return mem.events.has(id);
}

export async function recordEvent(e) {
  const doc = { ...e, at: e.at || new Date() };
  if (mode === 'mongo') {
    try { await Event.create(doc); } catch (err) { if (err.code !== 11000) throw err; }
    return doc;
  }
  mem.events.set(e._id, clone(doc));
  return doc;
}

export async function updateEvent(id, patch) {
  if (mode === 'mongo') return Event.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  const e = { ...mem.events.get(id), ...clone(patch) };
  mem.events.set(id, e);
  return clone(e);
}

export async function listEvents(userId, limit = 30) {
  if (mode === 'mongo') return Event.find({ userId }).sort({ at: -1 }).limit(limit).lean();
  return [...mem.events.values()]
    .filter((e) => e.userId === userId)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

// Demo reset: wipe everything that is not banking data.
export async function clearMemory() {
  if (mode === 'memory') {
    mem.conversations.clear();
    mem.scenarios.clear();
    mem.pending.clear();
    mem.events.clear();
  } else {
    await Promise.all([Conversation.deleteMany({}), Scenario.deleteMany({}), Pending.deleteMany({}), Event.deleteMany({})]);
  }
}

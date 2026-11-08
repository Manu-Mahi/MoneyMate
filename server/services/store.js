import mongoose from 'mongoose';
import config from '../config.js';

// Persistence for conversations, scenarios and pending transactions.
// Uses MongoDB Atlas when MONGODB_URI is set, otherwise an in-memory store
// with the same interface so the app always runs.

let mode = 'memory';

const ConversationSchema = new mongoose.Schema(
  {
    _id: String,
    userId: String,
    messages: [{ role: String, text: String, scenarioIds: [String], pendingId: String, at: Date }],
    lastScenarioIds: [String],
  },
  { timestamps: true },
);

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
    status: { type: String, default: 'pending' },
    expiresAt: Date,
    executedAt: Date,
    nessieTransferId: String,
    summary: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);
// Audit trail: keep records, but drop never-confirmed ones a day after expiry.
PendingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400, partialFilterExpression: { status: 'pending' } });

let Conversation, Scenario, Pending;
const mem = { conversations: new Map(), scenarios: new Map(), pending: new Map() };

export async function initStore() {
  if (!config.mongoUri) {
    console.log('[store] MONGODB_URI not set — using in-memory store');
    return mode;
  }
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 6000 });
    Conversation = mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
    Scenario = mongoose.models.Scenario || mongoose.model('Scenario', ScenarioSchema);
    Pending = mongoose.models.PendingTransaction || mongoose.model('PendingTransaction', PendingSchema);
    mode = 'mongo';
    console.log('[store] connected to MongoDB Atlas');
  } catch (err) {
    console.warn(`[store] MongoDB connection failed, using memory: ${err.message}`);
  }
  return mode;
}

export const storeMode = () => mode;

const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);

export async function getConversation(id) {
  if (mode === 'mongo') return (await Conversation.findById(id).lean()) || null;
  return clone(mem.conversations.get(id)) || null;
}

export async function saveConversation(conv) {
  if (mode === 'mongo') {
    await Conversation.findByIdAndUpdate(conv._id, conv, { upsert: true });
    return conv;
  }
  mem.conversations.set(conv._id, clone({ ...conv, updatedAt: new Date() }));
  return conv;
}

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
  if (mode === 'mongo') return Pending.findByIdAndUpdate(id, patch, { new: true }).lean();
  const p = { ...mem.pending.get(id), ...clone(patch) };
  mem.pending.set(id, p);
  return clone(p);
}

export async function listPending(userId) {
  if (mode === 'mongo') return Pending.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
  return [...mem.pending.values()].filter((p) => p.userId === userId).reverse().slice(0, 20);
}

export async function clearMemory() {
  if (mode === 'memory') {
    mem.conversations.clear();
    mem.scenarios.clear();
    mem.pending.clear();
  }
}

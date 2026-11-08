import { getSnapshot, executeTransfer, findAccount } from './bank.js';
import * as store from './store.js';
import { money } from '../lib/util.js';

// The two-step commit, step two. Shared by the web Confirm button, text/phone
// channels ("yes") and any future client. Re-validates everything before money
// moves; the language model never calls this.

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function confirmPending(id, { userId } = {}) {
  const snap = await getSnapshot();
  const p = await store.getPending(id);
  if (!p) throw fail(404, 'Pending transaction not found');
  if (userId && p.userId !== userId) throw fail(403, 'Not your transaction');
  if (p.status !== 'pending') throw fail(409, `Transaction already ${p.status}`);
  if (new Date(p.expiresAt) < new Date()) {
    await store.updatePending(p._id, { status: 'expired' });
    throw fail(410, 'This confirmation expired. Ask again to set it up.');
  }
  const from = findAccount(snap, p.fromId);
  if (!from || from.balance < p.amount) throw fail(400, 'Insufficient funds for this transfer now.');

  const result = await executeTransfer({ fromId: p.fromId, toId: p.toId, amount: p.amount, description: `MoneyCall: ${p.label}` });
  const updated = await store.updatePending(p._id, {
    status: 'executed', executedAt: new Date(), nessieTransferId: result.nessieTransferId, syncNote: result.syncNote,
  });
  const message = `Done. ${money(p.amount)} moved from ${result.from.nickname} to ${result.to.nickname}. ${result.from.nickname} now has ${money(result.from.balance)}.`;
  return { pending: updated, message, result };
}

export async function cancelPending(id, { userId } = {}) {
  const p = await store.getPending(id);
  if (!p) throw fail(404, 'Pending transaction not found');
  if (userId && p.userId !== userId) throw fail(403, 'Not your transaction');
  if (p.status !== 'pending') throw fail(409, `Transaction already ${p.status}`);
  return store.updatePending(p._id, { status: 'cancelled' });
}

// The most recent pending transaction attached to a conversation, if it is
// still open. Used to bind a spoken or texted "yes" to a specific pending id.
export async function openPendingFor(conv) {
  const last = [...(conv?.messages || [])].reverse().find((m) => m.pendingId);
  if (!last) return null;
  const p = await store.getPending(last.pendingId);
  if (!p || p.status !== 'pending' || new Date(p.expiresAt) < new Date()) return null;
  return p;
}

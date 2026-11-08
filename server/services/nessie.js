import config from '../config.js';

// Thin client for Capital One's Nessie API (https://api.nessieisreal.com).
// The key goes in the `key` query parameter. Field names follow the live
// sandbox: bills carry payment_date / recurring_date / upcoming_payment_date,
// purchases carry purchase_date, deposits/withdrawals/transfers carry
// transaction_date, loans carry monthly_payment and amount.

async function request(method, path, body, { timeoutMs = 10000 } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${config.nessie.base}${path}${sep}key=${encodeURIComponent(config.nessie.key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`Nessie ${method} ${path} → ${res.status}: ${data?.message || data?.code || text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Nessie answers 404 for an empty sub-collection (e.g. an account with no
// transfers yet); treat that as an empty list.
async function list(path) {
  try {
    const data = await request('GET', path);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export const createdId = (res) => res?.objectCreated?._id || res?.objectCreated?.id || res?._id || res?.id || null;

export const nessie = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  list,

  customers: () => list('/customers'),
  customer: (customerId) => request('GET', `/customers/${customerId}`),
  customerAccounts: (customerId) => list(`/customers/${customerId}/accounts`),
  account: (accountId) => request('GET', `/accounts/${accountId}`),
  bills: (accountId) => list(`/accounts/${accountId}/bills`),
  purchases: (accountId) => list(`/accounts/${accountId}/purchases`),
  deposits: (accountId) => list(`/accounts/${accountId}/deposits`),
  withdrawals: (accountId) => list(`/accounts/${accountId}/withdrawals`),
  transfers: (accountId) => list(`/accounts/${accountId}/transfers`),
  loans: (accountId) => list(`/accounts/${accountId}/loans`),
  merchants: () => list('/merchants'),

  // The current sandbox models a transfer as a record on the source account
  // (transaction_date, status, integer amount, description; no payee field) and
  // never changes balances itself. MoneyCall therefore writes two records, a
  // transfer on the source and a deposit on the destination, both tagged with
  // MONEYCALL_TAG, and replays them on load so balances survive a restart.
  createTransfer: async (fromAccountId, { toAccountId, toNickname, fromNickname, amount, description, date }) => {
    const whole = Math.round(amount);
    const t = await request('POST', `/accounts/${fromAccountId}/transfers`, {
      transaction_date: date,
      status: 'completed',
      amount: whole,
      description: `${MONEYCALL_TAG} ${description || 'Transfer'} → ${toNickname || 'account'} [to:${toAccountId}]`,
    });
    const transferId = createdId(t);
    let depositId = null;
    try {
      const d = await request('POST', `/accounts/${toAccountId}/deposits`, {
        medium: 'balance',
        transaction_date: date,
        status: 'completed',
        amount: whole,
        description: `${MONEYCALL_TAG} Transfer from ${fromNickname || 'account'} [from:${fromAccountId}] [transfer:${transferId}]`,
      });
      depositId = createdId(d);
    } catch (err) {
      console.warn(`[nessie] destination deposit failed (${err.message}); source transfer ${transferId} stands`);
    }
    return { transferId, depositId };
  },
  deleteTransfer: (id) => request('DELETE', `/transfers/${id}`),
  deleteDeposit: (id) => request('DELETE', `/deposits/${id}`),
};

export const MONEYCALL_TAG = 'MoneyCall:';
export const isMoneyCallRecord = (x) => String(x?.description || '').startsWith(MONEYCALL_TAG);
export const recordId = (x) => x?._id || x?.id;

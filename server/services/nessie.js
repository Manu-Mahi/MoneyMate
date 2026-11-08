import config from '../config.js';

// Thin client for Capital One's Nessie API (http://api.nessieisreal.com).
// The key goes in the `key` query parameter.

async function request(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${config.nessie.base}${path}${sep}key=${encodeURIComponent(config.nessie.key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(`Nessie ${method} ${path} → ${res.status}: ${data?.message || text}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const nessie = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),

  customerAccounts: (customerId) => request('GET', `/customers/${customerId}/accounts`),
  customer: (customerId) => request('GET', `/customers/${customerId}`),
  bills: (accountId) => request('GET', `/accounts/${accountId}/bills`),
  purchases: (accountId) => request('GET', `/accounts/${accountId}/purchases`),
  deposits: (accountId) => request('GET', `/accounts/${accountId}/deposits`),
  withdrawals: (accountId) => request('GET', `/accounts/${accountId}/withdrawals`),
  transfers: (accountId) => request('GET', `/accounts/${accountId}/transfers`),
  loans: (accountId) => request('GET', `/accounts/${accountId}/loans`),

  createTransfer: (fromAccountId, { toAccountId, amount, description, date }) =>
    request('POST', `/accounts/${fromAccountId}/transfers`, {
      medium: 'balance',
      payee_id: toAccountId,
      amount,
      transaction_date: date,
      description,
    }),
};

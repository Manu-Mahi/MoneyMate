const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  status: () => request('GET', '/status'),
  overview: () => request('GET', '/overview'),
  chat: (message, conversationId) => request('POST', '/chat', { message, conversationId }),
  simulate: (body) => request('POST', '/simulate', body),
  createPending: (scenarioId) => request('POST', '/transactions/pending', { scenarioId }),
  confirm: (id) => request('POST', `/transactions/${id}/confirm`),
  cancel: (id) => request('POST', `/transactions/${id}/cancel`),
  scenarios: () => request('GET', '/scenarios'),
  activity: () => request('GET', '/activity'),
  reset: () => request('POST', '/demo/reset'),
};

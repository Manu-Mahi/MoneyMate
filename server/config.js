import 'dotenv/config';

const config = {
  port: Number(process.env.PORT || 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  // Public HTTPS origin of this server (needed for Photon webhooks), e.g. https://api.moneycall.app
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  gemini: {
    key: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  },
  nessie: {
    key: process.env.NESSIE_API_KEY || '',
    // Nessie only answers over HTTPS; port 80 refuses connections.
    base: (process.env.NESSIE_BASE_URL || 'https://api.nessieisreal.com').replace(/\/$/, '').replace(/^http:\/\//, 'https://'),
    customerId: process.env.NESSIE_CUSTOMER_ID || '',
  },
  mongoUri: process.env.MONGODB_URI || '',
  photon: {
    base: (process.env.PHOTON_BASE_URL || 'https://api.photon.codes').replace(/\/$/, ''),
    projectId: process.env.PHOTON_PROJECT_ID || '',
    apiKey: process.env.PHOTON_API_KEY || '',
    webhookSecret: process.env.PHOTON_WEBHOOK_SECRET || '',
    // Webhook payload API version (see GET /v1/projects/{id}/webhooks/api-versions)
    apiVersion: process.env.PHOTON_API_VERSION || '2026-07-01',
    // Phones (E.164) that get a shared iMessage line at startup, e.g. +19725550100,+14085550100
    phones: String(process.env.PHOTON_PHONES || '').split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean),
  },
  // 4-digit PIN that confirms transfers on text/voice channels. Empty = a plain "yes" confirms.
  transferPin: /^\d{4}$/.test(process.env.TRANSFER_PIN || '') ? process.env.TRANSFER_PIN : '',
  pinMaxAttempts: 3,
  // Optional shared secret for POST /api/channels/message (voice agents, scripts).
  channelSecret: process.env.CHANNEL_SECRET || '',
  useSynthetic: String(process.env.USE_SYNTHETIC_DATA || 'false').toLowerCase() === 'true',
  safetyThreshold: Number(process.env.SAFETY_THRESHOLD || 100),
  pendingTtlMinutes: 5,
};

export const hasGemini = () => Boolean(config.gemini.key);
export const hasNessie = () => Boolean(config.nessie.key && config.nessie.customerId && !config.useSynthetic);
export const hasPhoton = () => Boolean(config.photon.projectId && config.photon.apiKey);

export default config;

import 'dotenv/config';

const config = {
  port: Number(process.env.PORT || 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  gemini: {
    key: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  nessie: {
    key: process.env.NESSIE_API_KEY || '',
    base: (process.env.NESSIE_BASE_URL || 'http://api.nessieisreal.com').replace(/\/$/, ''),
    customerId: process.env.NESSIE_CUSTOMER_ID || '',
  },
  mongoUri: process.env.MONGODB_URI || '',
  useSynthetic: String(process.env.USE_SYNTHETIC_DATA || 'false').toLowerCase() === 'true',
  safetyThreshold: Number(process.env.SAFETY_THRESHOLD || 100),
  pendingTtlMinutes: 5,
};

export const hasGemini = () => Boolean(config.gemini.key);
export const hasNessie = () => Boolean(config.nessie.key && config.nessie.customerId && !config.useSynthetic);

export default config;

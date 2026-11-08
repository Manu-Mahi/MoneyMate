import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import config, { hasGemini, hasNessie, hasPhoton } from './config.js';
import api from './routes/api.js';
import photonRoutes from './routes/photon.js';
import { initStore, upsertUser } from './services/store.js';
import { getSnapshot } from './services/bank.js';
import { monthlyFigures } from './services/health.js';
import { ensurePhoneAssignments, logAssignments } from './services/photon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initStore();
  const snap = await getSnapshot();
  // Demo profile lives in the `users` collection (name, Nessie id, preferences).
  const { user } = snap;
  await upsertUser({
    _id: user.id, name: user.name, email: user.email, nessieCustomerId: user.nessieCustomerId || null,
    safetyThreshold: user.safetyThreshold, monthlyIncome: monthlyFigures(snap).income,
    payAmount: user.payAmount, payFrequencyDays: user.payFrequencyDays, nextPayDate: user.nextPayDate,
    dailySpend: user.dailySpend, source: snap.source,
  }).catch((err) => console.warn('[store] user upsert failed:', err.message));

  // Phones listed in PHOTON_PHONES get an iMessage line; runs in the background so startup never waits on Photon.
  if (hasPhoton() && config.photon.phones.length) {
    ensurePhoneAssignments().then(logAssignments).catch((err) => console.warn('[photon] phone registration failed:', err.message));
  }

  const app = express();
  app.use(cors({ origin: config.clientOrigin === '*' ? true : config.clientOrigin.split(',') }));
  // Keep the raw body: Photon webhook signatures are computed over the exact bytes.
  app.use(express.json({ limit: '200kb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/api/photon', photonRoutes);
  app.use('/api', api);

  // Serve the built React app when present (single-server deploys, e.g. a GoDaddy VPS).
  const dist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  });
  return app;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  const app = await createApp();
  app.listen(config.port, () => {
    console.log(`MoneyCall API on http://localhost:${config.port}`);
    console.log(`  Gemini: ${hasGemini() ? config.gemini.model : 'off (local engine)'} · Nessie: ${hasNessie() ? 'on' : 'off (synthetic data)'} · Photon: ${hasPhoton() ? (config.photon.webhookSecret ? 'on' : 'on (no webhook secret)') : 'off'}`);
  });
}

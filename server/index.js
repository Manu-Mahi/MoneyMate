import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import config, { hasGemini, hasNessie } from './config.js';
import api from './routes/api.js';
import { initStore } from './services/store.js';
import { getSnapshot } from './services/bank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initStore();
  await getSnapshot();

  const app = express();
  app.use(cors({ origin: config.clientOrigin === '*' ? true : config.clientOrigin.split(',') }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', api);

  // Serve the built React app when present (single-server deploys, e.g. a GoDaddy VPS).
  const dist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    console.error(err);
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
    console.log(`  Gemini: ${hasGemini() ? config.gemini.model : 'off (local engine)'} · Nessie: ${hasNessie() ? 'on' : 'off (synthetic data)'}`);
  });
}

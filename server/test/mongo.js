// Runs the smoke test against a real MongoDB (in-memory server binary) so the
// Atlas code path in services/store.js is exercised, not just the Map fallback.
//   cd server && npm run test:mongo
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri('moneycall_test');
console.log(`[test:mongo] MongoDB at ${uri}`);

const smoke = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smoke.js');
const child = spawn(process.execPath, [smoke], { stdio: 'inherit', env: { ...process.env, SMOKE_MONGODB_URI: uri } });
const code = await new Promise((resolve) => child.on('exit', resolve));
await mongod.stop();
process.exit(code ?? 1);

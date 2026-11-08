// One-time Photon setup for MoneyCall text & phone banking.
//   cd server && npm run photon:setup -- [--webhook https://your.host] [--imessage +15551234567] [--sms-number [areaCode]]
// Needs PHOTON_PROJECT_ID and PHOTON_API_KEY (scopes: project:read, project:write, platforms:read, platforms:write).
import config, { hasPhoton } from '../config.js';
import { photon, DEFAULT_EVENTS, ensurePhoneAssignments, logAssignments } from '../services/photon.js';

if (!hasPhoton()) {
  console.error('Set PHOTON_PROJECT_ID and PHOTON_API_KEY in server/.env first (https://app.beta.photon.codes → Settings / API keys).');
  process.exit(1);
}
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};

console.log(`Project ${config.photon.projectId}`);
const lines = await photon.listResources({ state: 'active' }).catch((e) => ({ resources: [], error: e.message }));
if (lines.error) console.warn('Could not list lines:', lines.error);
console.log(`Lines: ${lines.resources.length}`);
for (const r of lines.resources) console.log(`  ${r.resourceId}  ${r.type}  [${r.abilities.join(', ')}]  ${r.detail?.phoneNumber || r.detail?.handle || ''}`);

const webhookBase = flag('--webhook') || config.publicUrl;
if (webhookBase && webhookBase !== true) {
  const url = `${String(webhookBase).replace(/\/$/, '')}/api/photon/webhook`;
  const existing = await photon.listWebhookDestinations().catch(() => null);
  const list = existing?.destinations || existing?.items || [];
  const dup = list.find((d) => d.url === url);
  if (dup) {
    console.log(`\nWebhook destination already exists for ${url} (${dup.destinationId || dup.id}). Delete it in the dashboard to rotate the secret.`);
  } else {
    const created = await photon.createWebhookDestination({ url, events: DEFAULT_EVENTS });
    console.log(`\nWebhook destination created for ${url}`);
    console.log('Add this to server/.env (shown only once):\n');
    console.log(`PHOTON_WEBHOOK_SECRET=${created.signingSecret}\n`);
  }
} else {
  console.log('\nNo --webhook <https url> given: skipping webhook destination. Photon needs a public HTTPS URL, e.g. an ngrok/cloudflared tunnel to http://localhost:5000.');
}

// Phones from --imessage plus PHOTON_PHONES in .env; existing assignments are reused.
const handle = flag('--imessage');
const phones = [...config.photon.phones, ...(handle && handle !== true ? [handle] : [])];
if (phones.length) {
  console.log('');
  logAssignments(await ensurePhoneAssignments(phones));
  console.log('Each phone must send the first iMessage to its own number.');
} else {
  console.log('\nNo phones to register: set PHOTON_PHONES in .env or pass --imessage +1XXXXXXXXXX.');
}

const sms = flag('--sms-number');
if (sms) {
  const op = await photon.purchaseSmsNumber({ areaCode: sms === true ? undefined : String(sms), promotionCode: process.env.PHOTON_PROMO_CODE });
  console.log('\nSMS number order started (poll the operation in the dashboard):', op.operationId || op);
  console.log('Note: sending SMS to US numbers requires an approved 10DLC campaign; iMessage shared lines do not.');
}

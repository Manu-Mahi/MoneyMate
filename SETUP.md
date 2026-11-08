# Local setup

How to get MoneyCall running on your machine after cloning the repo. Getting the API keys themselves is covered in the README; this assumes a teammate hands you a filled-in `server/.env`.

## Prerequisites

- Node.js 18 or newer and npm
- Chrome or Edge (the microphone features need the Web Speech API)
- `cloudflared` for the Photon text channel: `winget install Cloudflare.cloudflared` (PowerShell)

## 1. Install

From the repo root:

```
npm run setup
npm test
```

`npm run setup` installs the server and the client. `npm test` must end with `All checks passed`; it runs the whole demo against the built-in synthetic data and needs no keys.

## 2. Environment file

Ask a teammate for `server/.env` and drop it into `server/`. Do not type values into `server/.env.example`; that file is committed to git, `.env` is not.

What's in it:

| Group | Variables | Notes |
| --- | --- | --- |
| Shared service keys | `GEMINI_API_KEY`, `NESSIE_API_KEY`, `NESSIE_CUSTOMER_ID`, `MONGODB_URI`, `PHOTON_PROJECT_ID`, `PHOTON_API_KEY` | Same for the whole team. Copy as given. |
| Machine-specific | `PUBLIC_URL`, `PHOTON_WEBHOOK_SECRET` | Tied to your tunnel. You replace both in step 4. |
| Security settings | `PHOTON_PHONES`, `TRANSFER_PIN`, `CHANNEL_SECRET` | Who may text in, the PIN that authorizes transfers, and the header external callers must send. Steps 5 and 6. |

The server reads `.env` only at startup, so any change means restarting it.

## 3. Run the app

Three terminal windows, from the repo root, in this order. Keep all three open.

| Window | Command | What it is |
| --- | --- | --- |
| 1 | `cloudflared tunnel --url http://localhost:5000` | Public HTTPS address for Photon. Only needed for text banking. |
| 2 | `npm run dev:server` | API server on http://localhost:5000 |
| 3 | `npm run dev:client` | Web app on http://localhost:5173 |

The first lines of the server log should include `connected to MongoDB (moneycall)` and `loaded 7 accounts … from Nessie`. The sidebar's **Connected services** panel shows the same, and so does:

```
curl http://localhost:5000/api/status
```

Everything is up when it shows `"gemini":true`, `"nessieLive":true`, `"store":"mongo"`, `"photon":true`, `"photonWebhook":true`.

## 4. Point Photon at your machine

Photon delivers texts to one URL per project, and a tunnel URL is unique to the machine and session that started it. So every time the tunnel starts, Photon has to be told the new address.

1. In the tunnel window, scroll up to the box **Your quick Tunnel has been created!** and copy the `https://….trycloudflare.com` URL.
2. With the server running:
   ```
   cd server && npm run photon:setup -- --webhook https://YOUR-TUNNEL-URL
   ```
3. It prints `PHOTON_WEBHOOK_SECRET=whsec_…`. Put that value and the tunnel URL into `server/.env`:
   ```
   PUBLIC_URL=https://YOUR-TUNNEL-URL
   PHOTON_WEBHOOK_SECRET=whsec_…
   ```
4. Restart the server (window 2). `.env` is read only at startup.

**About the secret.** Photon shows it exactly once, when the webhook is created. It is not in the dashboard and not your API key. If it is lost, delete the webhook destination in the Photon dashboard and rerun step 2. With a wrong secret the server rejects every text, so if replies stop after a tunnel restart, this is the first thing to check. Old destinations pointing at dead tunnel URLs can be deleted in the dashboard under Webhooks.

## 5. Add phones

Each phone that should text MoneyCall needs its own shared iMessage line. List them in `server/.env`, comma-separated, in `+1XXXXXXXXXX` format:

```
PHOTON_PHONES=+19725550100,+14085550100
```

On startup the server makes sure every listed phone has a line and prints the pairing in its log:

```
[photon] iMessage lines (phone → number to text):
  +19725550100    → +16285550123
  +14085550100    → +16285550456  (new)
```

Each phone texts its own number, as an iMessage (blue bubble), and must send the first message. Adding a phone later: append it to `PHOTON_PHONES` and restart the server, or run `cd server && npm run photon:setup` which does the same without a restart.

Only phones in this list can reach MoneyCall. A shared line accepts messages from its paired phone alone; anything else is dropped by Photon before it reaches the server.

## 6. Transfer PIN

```
TRANSFER_PIN=2468
```

A 4-digit PIN in `server/.env` is what authorizes a transfer from text or voice. Pick your own; the value above is a placeholder. How it behaves:

- After previewing a transfer, MoneyCall asks for the PIN. The transfer stays pending for 5 minutes.
- "yes" alone is refused with a reminder to send the PIN.
- A wrong PIN leaves the transfer pending and says how many attempts remain.
- The third wrong PIN cancels the transfer and nothing moves. Attempts are recorded in the audit trail.
- "no" cancels at any point.
- The PIN is masked as •••• before the conversation is stored, so it never reaches Atlas or the web UI.
- Leave `TRANSFER_PIN` empty and a plain YES confirms instead.

The web app's Confirm button is unchanged: the browser session itself is the authorization there.

Also in this group: `CHANNEL_SECRET`. If set, any external caller of `POST /api/channels/message` (a voice agent, a script) must send it in the `x-channel-secret` header. The in-app demo phone is exempt. Leave it empty unless you connect a voice agent.

**Keep these out of git.** `TRANSFER_PIN`, `PHOTON_WEBHOOK_SECRET` and `CHANNEL_SECRET` live only in `server/.env`. Never paste them into `server/.env.example`, screenshots or chat; the smoke test uses its own fake values.

## 7. Check the text channel

From an added phone, iMessage its number:

1. `balance`
2. `move $300 to savings` → preview, then "Reply with your 4-digit PIN to confirm, or NO to cancel."
3. `yes` → refused, asks for the PIN again
4. `2468` (your PIN) → "Done. $300 moved…"
5. `move $20 to savings`, then `no` → cancelled

Replies arrive in the thread and show up in the web app under **AI Banking Assistant → Text & phone banking**. If nothing comes back, the server log line `[photon] event processing failed: …` says why, and `curl http://localhost:5000/api/channels/activity` lists what arrived.

## Every time you start work

1. Start the tunnel. If its URL differs from `PUBLIC_URL` in `.env`, do step 4 again.
2. Start the server, then the client. Check the log for the `[photon] iMessage lines` table; every phone that will text today should be in it.
3. Make sure everyone texting knows the current `TRANSFER_PIN`.
4. Press **Reset demo** in the top bar so balances start at $2,500 / $1,000.

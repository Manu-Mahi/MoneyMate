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

Two values in that file are machine-specific and you will replace them in step 4: `PUBLIC_URL` and `PHOTON_WEBHOOK_SECRET`.

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

## 6. Transfer PIN

`TRANSFER_PIN=2468` in `server/.env` sets the 4-digit PIN that confirms transfers from text and voice. After MoneyCall previews a transfer it asks for the PIN; "yes" alone is refused, a wrong PIN gets two more tries, and the third wrong PIN cancels the transfer. The PIN is masked in the stored conversation. Leave the variable empty to confirm with a plain YES instead. The web app's Confirm button is unchanged.

## 7. Check the text channel

From an added phone, iMessage its number:

1. `balance`
2. `move $300 to savings`
3. `2468` (your PIN)

Replies arrive in the thread and show up in the web app under **AI Banking Assistant → Text & phone banking**. If nothing comes back, the server log line `[photon] event processing failed: …` says why, and `curl http://localhost:5000/api/channels/activity` lists what arrived.

## Every time you start work

1. Start the tunnel. If its URL differs from `PUBLIC_URL` in `.env`, do step 4 again.
2. Start the server, then the client.
3. Press **Reset demo** in the top bar so balances start at $2,500 / $1,000.

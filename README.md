# Chatter Bank

**Don't just manage your money. Understand what happens next.**

Chatter Bank is a conversational banking assistant that checks the future before you act. Ask it to move money or make a purchase by voice, text message, phone call or chat. It projects your next 30 days of balances, bills and paychecks, explains the risk in plain language, offers a safer amount, and only moves (simulated) money after you explicitly confirm.

Built for the **PNC 360° Financial Health Navigator** challenge, with Capital One Nessie, Gemini API, MongoDB Atlas, Photon and a GoDaddy-hosted domain.

---

## Quick start (2 minutes, no keys needed)

```bash
npm run setup          # installs server + client
npm run test           # runs the full judge demo against the API (should say "All checks passed")
npm run dev:server     # API on http://localhost:5000
npm run dev:client     # app on http://localhost:5173 (new terminal)
```

Without any API keys, Chatter Bank runs on a synthetic persona (Alex Morgan), a built-in local language engine and an in-memory store. Every number, chart and confirmation works the same. Add keys to turn on the live services:

```bash
cp server/.env.example server/.env   # then fill in the keys
```

| Variable | What it turns on | How to verify |
| --- | --- | --- |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini function-calling agent (falls back to the local engine on any error). Default model `gemini-3.8-flash`; if Google retires a model id, the server follows the replacement named in the error | Chat replies show a "Gemini" badge |
| `NESSIE_API_KEY`, `NESSIE_CUSTOMER_ID` | Live Capital One Nessie accounts, bills, deposits, purchases, withdrawals, loans and transfers | `npm run seed` once (creates the demo customer, prints the id), then `npm run nessie:check` |
| `MONGODB_URI` | MongoDB Atlas persistence: users, conversations, scenarios, pending transactions, channel events | Server logs `connected to MongoDB`; `npm run test:mongo` runs the whole demo against a real MongoDB |
| `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `PHOTON_WEBHOOK_SECRET` | Text banking over iMessage / SMS / WhatsApp and call logging through Photon | `npm run photon:setup -- --webhook https://your-host --imessage +1YOURPHONE` |
| `SAFETY_THRESHOLD` | The cash cushion (default $100) the forecast protects | |

The sidebar's **Connected services** panel shows which are live.

## How it meets the challenge

| PNC asks for | Chatter Bank delivers |
| --- | --- |
| One clear view across checking, savings, CDs, IRAs, loans and cards | **All accounts** panel (7 accounts) and **net worth** (assets vs owed) |
| A conversational coach | Voice, chat, text-message and phone assistant that uses real tool results and gives one concrete next step |
| 3+ health indicators | **5 indicators**: cash runway, debt burden, savings rate, credit utilization, debt-to-assets. They roll up into a 0–100 score with a focus tip |
| Forecast balances and obligations | 30-day day-by-day projection with paychecks, every bill and average spending, plus a money timeline |
| "What if" simulator | Ask in chat ("What if only $300?") or use the simulator for transfers, purchases and debt payments. Up to two scenarios are compared on one chart |
| Something new | **Pre-transaction intelligence.** A transfer is checked against future bills before it can be confirmed. **Safe to Spend** shows the most you can spend today without breaking your cushion. A two-step confirm keeps the AI from ever moving money on its own, on every channel |

| Sponsor | Where it lives |
| --- | --- |
| Capital One Nessie | `server/services/nessie.js`, `bank.js` (accounts, bills, purchases, deposits, withdrawals, loans, `POST /accounts/{id}/transfers`), `seed/seed.js`, `scripts/nessie-check.js` |
| Gemini API | `server/services/gemini.js`: 9 function declarations in `tools.js`, multi-step tool loop, channel-aware system prompt |
| MongoDB Atlas | `server/services/store.js`: `users`, `conversations`, `scenarios`, `pendingTransactions` (TTL index), `channelEvents` |
| Photon | `server/services/photon.js`, `routes/photon.js` (signed webhook → chat → reply), `services/channels.js`, `scripts/photon-setup.js`, the **Text & phone banking** card |
| GoDaddy | Deploy steps below. Register the domain through GoDaddy Registry for the domain prize |

## The judge demo (2 minutes)

Seed data: checking $2,500, savings $1,000, rent $1,800 due in 5 days, paycheck in 12 days.

1. "How much money do I have?" → balances.
2. "Transfer $1,000 to my savings" → **Risky**. Checking would drop to −$375 the day rent is due. Chatter Bank offers a safe amount instead of setting up the transfer.
3. "What if I transfer only $300?" → both options on one chart. $300 is **Safe**.
4. "Okay, transfer $300" → confirmation card. Say "confirm" or click **Confirm $300**.
5. Balances update to $2,200 / $1,300, the forecast redraws, and the audit trail records it.
6. Open **AI Banking Assistant → Text & phone banking** and text "move $10 to savings", then "yes". The same guardrails run over a text thread; the transfer is bound to that thread's pending id.

Use **Reset demo** in the top bar to run it again. Other good prompts: "How healthy are my finances?", "How much can I safely spend before payday?", "Can I afford a $600 laptop on my card?", "Pay $200 toward my credit card".

## Architecture

```
React (Vite, Tailwind, Recharts, Web Speech)      Photon line (iMessage / SMS / WhatsApp / voice)
        │  /api                                            │  signed webhook
Express ── chat orchestrator ── Gemini tool loop  (local engine fallback)
        ├─ channels        (one entry point for web, text, phone; "yes" binds to a pending id)
        ├─ simulation engine  (forecast, risk, safe amount)
        ├─ health engine      (5 indicators + score)
        ├─ transaction service (pending → confirm, re-validation)
        ├─ bank layer ── Capital One Nessie  (synthetic fallback)
        └─ store ── MongoDB Atlas  (in-memory fallback)
```

**The guardrail.** Gemini only interprets the request and explains results. Every figure comes from backend tools. Executing a transfer is deliberately not a Gemini tool: the server creates a pending record that expires after 5 minutes and re-validates funds when you confirm, whether that is a button on the web, a texted "YES", or a spoken "yes" on a call.

### API

`GET /api/overview` · `/status` · `/accounts` · `/bills` · `/transactions` · `/health` · `/forecast` · `/scenarios` · `/activity` · `/conversations` · `/conversations/:id` · `/channels/activity` · `/photon/lines`
`POST /api/chat` · `/simulate` · `/compare` · `/transactions/pending` · `/transactions/:id/confirm` · `/transactions/:id/cancel` · `/channels/message` · `/photon/webhook` · `/demo/reset`

`POST /api/channels/message` takes `{ channel, handle, text }` and returns the reply plus any pending transaction. It is what the Photon webhook calls, what a voice agent's tool should call, and what the demo phone in the UI calls. Set `CHANNEL_SECRET` to require an `x-channel-secret` header.

## Capital One Nessie

1. Sign in at [nessieisreal.com](https://nessieisreal.com) and copy your API key into `NESSIE_API_KEY`. The API only answers over HTTPS (`https://api.nessieisreal.com`).
2. `cd server && npm run seed` creates the Alex Morgan customer with checking, savings and a credit card, nine bills, an auto loan, a payroll deposit and a grocery purchase, then prints `NESSIE_CUSTOMER_ID=…` to paste into `.env`.
3. `npm run nessie:check` shows exactly what Chatter Bank loads: it reads bills (`upcoming_payment_date` → `payment_date` → `recurring_date`), purchases, deposits, withdrawals and loans, infers the paycheck cadence from payroll deposits and everyday spend from recent purchases, and labels anything Nessie does not model (CD, IRA, student loan) as *linked*.
4. Confirmed transfers are written to Nessie as two tagged records: a `transfer` on the source account and a `deposit` on the destination (the current sandbox has no payee field on transfers, stores whole-dollar amounts, and never changes balances itself). On every load Chatter Bank replays its own tagged records on top of the stored balances, so a restart keeps the right numbers. **Reset demo** deletes those records in Nessie and reloads, which puts the judge demo back to $2,500 / $1,000. If the sandbox rejects a write, the transfer still completes locally and the audit trail shows a sync note, so a demo never stalls.

## MongoDB Atlas

Create a free cluster, add a database user, allow your IP (or `0.0.0.0/0` for the hackathon), then paste the **Drivers** connection string into `MONGODB_URI` with a database name, e.g. `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/moneycall`. Collections: `users` (profile, Nessie id, cushion, income), `conversations` (every channel), `scenarios`, `pendingTransactions` (TTL index drops never-confirmed records a day after expiry) and `channelEvents` (Photon texts and calls, keyed by webhook id so retries are no-ops). Without a URI the same code runs on an in-memory store; `npm run test:mongo` proves the Mongo path with a throwaway local MongoDB.

## Photon: text and phone banking

Photon gives Chatter Bank a phone number. Texts (iMessage, SMS, WhatsApp) arrive as signed webhooks and are answered by the same agent; the person confirms a transfer by replying **YES**. Calls are routed by SIP to a voice agent and logged in the audit trail.

1. In the [Photon dashboard](https://app.beta.photon.codes) create a project, copy the **Project ID** (`pho_prj_…`) and create an API key with `project:read`, `project:write`, `platforms:read`, `platforms:write`. Put both in `.env`. Hackathon promo code: `HACKWITHPHOTON`.
2. Expose the API over HTTPS (`PUBLIC_URL`, or locally `ngrok http 5000`), then:
   ```bash
   cd server && npm run photon:setup -- --webhook https://your-public-host --imessage +1YOURPHONE
   ```
   This registers `POST /api/photon/webhook` for `message.received` and `call.*` events, prints `PHOTON_WEBHOOK_SECRET` (paste it into `.env` and restart), and assigns a **shared iMessage line** your phone can text. Shared lines need no carrier campaign; a purchased SMS number (`--sms-number`) can send only after 10DLC approval.
3. List every phone that should text Chatter Bank in `PHOTON_PHONES` (comma-separated E.164). On startup the server gives each one a shared iMessage line and logs which number it should text. Set `TRANSFER_PIN` to a 4-digit PIN; transfers from text or voice are then confirmed by PIN (three wrong attempts cancel), not by a plain "yes".
4. Text the number from your phone: "balance", "move $300 to savings", then your PIN. The thread appears under **Text & phone banking** and every executed transfer shows `via imessage` in the audit trail.
5. **Voice.** In Photon, open **Voice → Set up default → SIP** and point inbound calls at a voice-agent provider (ElevenLabs cookbook: destination `sips:sip.rtc.elevenlabs.io:5061`, TLS). Give that agent one webhook tool, `POST {PUBLIC_URL}/api/channels/message` with `{ "channel": "voice", "handle": "{{caller}}", "text": "{{utterance}}" }` and the `x-channel-secret` header, and a prompt that reads the returned `reply` aloud. Spoken "yes" confirms the pending transfer exactly like the web button. Photon's `call.started` / `call.ended` events land in the activity list.

Without Photon credentials the **Text & phone banking** card still works as a demo phone against the same endpoint.

## Tests

```bash
npm test                      # judge script, text channel flow, Photon webhook signature/dedupe/call events (in-memory store)
npm --prefix server run test:mongo   # the same suite against a real MongoDB started locally
```

## Deploy on GoDaddy

**Option A: one server (VPS).** On a GoDaddy VPS with Node 18+:

```bash
git clone <repo> && cd moneycall && npm run setup && npm run build
cp server/.env.example server/.env   # add keys, set PUBLIC_URL=https://api.yourdomain.com
npm i -g pm2 && pm2 start server/index.js --name moneycall
```

Express serves the built app and the API together. Put Nginx in front on your domain and enable SSL. The microphone and Photon webhooks both need HTTPS.

**Option B: cPanel static site + Node backend.**

1. Set `VITE_API_URL=https://api.yourdomain.com/api` in `client/.env`, then run `npm run build`.
2. Upload `client/dist/*` to `public_html/`. The included `.htaccess` handles routing.
3. Run the server with cPanel's *Setup Node.js App* pointed at `server/index.js`, or on a VPS. Set `CLIENT_ORIGIN=https://yourdomain.com`.
4. In MongoDB Atlas, allow the server's IP address.

## Notes

- All banking data is synthetic or Nessie sandbox data. Nothing touches real money.
- Health thresholds are illustrative guidelines, not financial advice.
- If Nessie, Gemini, MongoDB or Photon is unreachable, the app falls back (synthetic data, local engine, in-memory store, demo phone) and says so in the sidebar.

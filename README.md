# MoneyCall

**Don't just manage your money. Understand what happens next.**

MoneyCall is a conversational banking assistant that checks the future before you act. Ask it to move money or make a purchase by voice or text. It projects your next 30 days of balances, bills and paychecks, explains the risk in plain language, offers a safer amount, and only moves (simulated) money after you explicitly confirm.

Built for the **PNC 360° Financial Health Navigator** challenge, with Capital One Nessie, Gemini API, MongoDB Atlas, and a GoDaddy-hosted domain.

---

## Quick start (2 minutes, no keys needed)

```bash
npm run setup          # installs server + client
npm run test           # runs the full judge demo against the API (should say "All checks passed")
npm run dev:server     # API on http://localhost:5000
npm run dev:client     # app on http://localhost:5173 (new terminal)
```

Without any API keys, MoneyCall runs on a synthetic persona (Alex Morgan) and a built-in local language engine. Every number, chart and confirmation works the same. Add keys to turn on the live services:

```bash
cp server/.env.example server/.env   # then fill in the keys
```

| Variable | What it turns on |
| --- | --- |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini function-calling agent (falls back to the local engine on any error) |
| `NESSIE_API_KEY`, `NESSIE_CUSTOMER_ID` | Live Capital One Nessie accounts, bills, loans and transfers. Run `npm run seed` once to create the demo customer and get the id |
| `MONGODB_URI` | MongoDB Atlas persistence for conversations, scenarios and the transfer audit trail |
| `SAFETY_THRESHOLD` | The cash cushion (default $100) the forecast protects |

The sidebar's **Connected services** panel shows which are live.

## How it meets the challenge

| PNC asks for | MoneyCall delivers |
| --- | --- |
| One clear view across checking, savings, CDs, IRAs, loans and cards | **All accounts** panel (7 accounts) and **net worth** (assets vs owed) |
| A conversational coach | Voice and text assistant that uses real tool results and gives one concrete next step |
| 3+ health indicators | **5 indicators**: cash runway, debt burden, savings rate, credit utilization, debt-to-assets. They roll up into a 0–100 score with a focus tip |
| Forecast balances and obligations | 30-day day-by-day projection with paychecks, every bill and average spending, plus a money timeline |
| "What if" simulator | Ask in chat ("What if only $300?") or use the simulator for transfers, purchases and debt payments. Up to two scenarios are compared on one chart |
| Something new | **Pre-transaction intelligence.** A transfer is checked against future bills before it can be confirmed. **Safe to Spend** shows the most you can spend today without breaking your cushion. A two-step confirm keeps the AI from ever moving money on its own |

| Sponsor | Where it lives |
| --- | --- |
| Capital One Nessie | `server/services/nessie.js`, `bank.js` (accounts, bills, purchases, deposits, loans, `POST /accounts/{id}/transfers`), `seed/seed.js` |
| Gemini API | `server/services/gemini.js`: 9 function declarations in `tools.js`, multi-step tool loop |
| MongoDB Atlas | `server/services/store.js`: conversations, scenarios, pending transactions with TTL index |
| GoDaddy | Deploy steps below. Register the domain through GoDaddy Registry for the domain prize |
| Photon (optional) | Not integrated yet. Voice works in the browser through the Web Speech API |

## The judge demo (2 minutes)

Seed data: checking $2,500, savings $1,000, rent $1,800 due in 5 days, paycheck in 12 days.

1. "How much money do I have?" → balances.
2. "Transfer $1,000 to my savings" → **Risky**. Checking would drop to −$375 the day rent is due. MoneyCall offers a safe amount instead of setting up the transfer.
3. "What if I transfer only $300?" → both options on one chart. $300 is **Safe**.
4. "Okay, transfer $300" → confirmation card. Say "confirm" or click **Confirm $300**.
5. Balances update to $2,200 / $1,300, the forecast redraws, and the audit trail records it.

Use **Reset demo** in the top bar to run it again. Other good prompts: "How healthy are my finances?", "How much can I safely spend before payday?", "Can I afford a $600 laptop on my card?", "Pay $200 toward my credit card".

## Architecture

```
React (Vite, Tailwind, Recharts, Web Speech)
        │  /api
Express ── chat orchestrator ── Gemini tool loop  (local engine fallback)
        ├─ simulation engine  (forecast, risk, safe amount)
        ├─ health engine      (5 indicators + score)
        ├─ transaction service (pending → confirm, validation)
        ├─ bank layer ── Capital One Nessie  (synthetic fallback)
        └─ store ── MongoDB Atlas  (in-memory fallback)
```

**The guardrail.** Gemini only interprets the request and explains results. Every figure comes from backend tools. Executing a transfer is deliberately not a Gemini tool: the server creates a pending record that expires after 5 minutes and re-validates funds when you confirm.

### API

`GET /api/overview` · `/status` · `/accounts` · `/bills` · `/transactions` · `/health` · `/forecast` · `/scenarios` · `/activity` · `/conversations/:id`
`POST /api/chat` · `/simulate` · `/compare` · `/transactions/pending` · `/transactions/:id/confirm` · `/transactions/:id/cancel` · `/demo/reset`

## Deploy on GoDaddy

**Option A: one server (VPS).** On a GoDaddy VPS with Node 18+:

```bash
git clone <repo> && cd moneycall && npm run setup && npm run build
cp server/.env.example server/.env   # add keys
npm i -g pm2 && pm2 start server/index.js --name moneycall
```

Express serves the built app and the API together. Put Nginx in front on your domain and enable SSL. The microphone needs HTTPS.

**Option B: cPanel static site + Node backend.**

1. Set `VITE_API_URL=https://api.yourdomain.com/api` in `client/.env`, then run `npm run build`.
2. Upload `client/dist/*` to `public_html/`. The included `.htaccess` handles routing.
3. Run the server with cPanel's *Setup Node.js App* pointed at `server/index.js`, or on a VPS. Set `CLIENT_ORIGIN=https://yourdomain.com`.
4. In MongoDB Atlas, allow the server's IP address.

## Notes

- All banking data is synthetic or Nessie sandbox data. Nothing touches real money.
- Health thresholds are illustrative guidelines, not financial advice.
- The Nessie integration follows the public API but was built without live access. Run `npm run seed` and check the dashboard. If Nessie is unreachable, the app falls back to synthetic data automatically and says so.

import config from '../config.js';
import { declarations, runTool } from './tools.js';
import { fmtDate, iso, startOfToday } from '../lib/util.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_STEPS = 6;

function systemPrompt(ctx) {
  const { user } = ctx.snap;
  const recent = (ctx.conv.lastScenarioIds || []).slice(-3).join(', ') || 'none';
  return `You are MoneyCall, a calm, plain-spoken banking coach for ${user.name}. Today is ${iso(startOfToday())} (${fmtDate(iso(startOfToday()))}).
All account data is SIMULATED demo data from the bank backend.

Rules:
- Always use tools for balances, bills, health and projections. Never guess or compute money figures yourself; quote the numbers tools return.
- Before any transfer, payment or purchase, call simulate_transfer or simulate_purchase and explain: the lowest projected checking balance, the date, and any bill at risk.
- If risk_level is "medium" or "high", say so plainly and offer the safe_alternative_amount if one is returned.
- For "what if" follow-ups, simulate the new option, then call compare_scenarios so the user sees both.
- Call create_pending_transaction only when the user clearly says to go ahead with a specific transfer you simulated. Then tell them to press Confirm. You cannot execute transactions.
- For questions about their overall situation, use get_accounts and get_financial_health and give one concrete next step.
- Keep replies to 1-3 short sentences, suitable to be read aloud. Use $ amounts. No markdown, no lists, no guarantees, no investment advice.
Recent scenario ids in this conversation: ${recent}.`;
}

async function callGemini(body) {
  const res = await fetch(`${API}/${encodeURIComponent(config.gemini.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || 'request failed'}`);
  return data;
}

export async function geminiAgent(message, ctx) {
  const history = (ctx.conv.messages || []).slice(-12).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
  const contents = [...history, { role: 'user', parts: [{ text: message }] }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const data = await callGemini({
      systemInstruction: { parts: [{ text: systemPrompt(ctx) }] },
      contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: { temperature: 0.3 },
    });
    const content = data?.candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error('Gemini returned no content');
    // Keep the model turn exactly as returned (preserves thought signatures).
    contents.push({ role: 'model', parts: content.parts });

    const calls = content.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = content.parts.map((p) => p.text || '').join('').trim();
      return text || 'Done.';
    }
    const responses = [];
    for (const { functionCall } of calls) {
      const result = await runTool(functionCall.name, functionCall.args, ctx);
      const part = { functionResponse: { name: functionCall.name, response: { result } } };
      if (functionCall.id) part.functionResponse.id = functionCall.id;
      responses.push(part);
    }
    contents.push({ role: 'user', parts: responses });
  }
  return 'I ran the numbers. Take a look at the impact preview.';
}

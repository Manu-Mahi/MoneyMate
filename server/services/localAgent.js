import { runTool, confirmHint } from './tools.js';
import { findAccount } from './bank.js';
import * as store from './store.js';
import { money, fmtDate } from '../lib/util.js';

// Deterministic fallback "brain" used when no Gemini key is set or Gemini
// errors. It drives the same backend tools, so the numbers and UI are
// identical — only the language is templated.

function parseAmount(text) {
  const t = text.replace(/,/g, '');
  let m = t.match(/\$\s?(\d+(?:\.\d{1,2})?)\s*(k)?\b/i);
  if (!m) m = t.match(/(\d+(?:\.\d{1,2})?)\s*(k)?\s*(?:dollars|bucks|usd)\b/i);
  if (!m) m = t.match(/\b(?:transfer|move|send|put|pay|buy|spend|only|just|about|of)\s+(\d+(?:\.\d{1,2})?)\s*(k)?\b/i);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

function parseAccount(text, word) {
  const re = new RegExp(`\\b${word}\\s+(?:my\\s+|the\\s+)?([a-z\\- ]{2,30})`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const riskWord = { low: 'safe', medium: 'tight', high: 'risky' };
const cap = (s) => s.replace(/\btheir\b/g, 'your').replace(/^\w/, (c) => c.toUpperCase());

async function lastScenario(ctx) {
  const id = (ctx.conv.lastScenarioIds || []).at(-1);
  return id ? store.getScenario(id) : null;
}

async function transferFlow(text, amount, ctx, { force = false, compare = false } = {}) {
  const { snap } = ctx;
  const prev = compare ? await lastScenario(ctx) : null;

  let fromRef = parseAccount(text, 'from');
  let toRef = parseAccount(text, 'to') || parseAccount(text, 'into') || parseAccount(text, 'toward');
  if (/\bpay\b/i.test(text) && !toRef) toRef = /loan|auto|car/i.test(text) ? 'auto loan' : 'credit card';
  if (!toRef && prev?.type === 'transfer') toRef = prev.action.toId;
  if (!fromRef && prev?.type === 'transfer') fromRef = prev.action.fromId;
  const from = findAccount(snap, fromRef || 'checking');
  let to = findAccount(snap, toRef || 'savings');
  if (to && from && to.id === from.id) to = findAccount(snap, from.type === 'checking' ? 'savings' : 'checking');

  const r = await runTool('simulate_transfer', { from_account: from?.id || 'checking', to_account: to?.id || 'savings', amount }, ctx);
  if (r.error) return r.error;

  if (compare && prev) {
    await runTool('compare_scenarios', { scenario_ids: [prev.id, r.scenario_id] }, ctx);
    const after = r.balances_after?.fromAfter;
    let reply = `With ${money(amount)}, ${from.nickname} keeps ${money(after)} and its lowest point is ${money(r.lowest_projected_checking.balance)} on ${fmtDate(r.lowest_projected_checking.date)}, which is ${riskWord[r.risk_level]}.`;
    reply += ` The earlier ${money(prev.amount)} option bottoms out at ${money(prev.scenario.lowest.balance)}. I've put both on the chart.`;
    if (r.risk_level === 'low') reply += ` Say "transfer ${money(amount)}" to go ahead.`;
    return reply;
  }

  if (r.risk_level === 'low' || force) {
    await runTool('create_pending_transaction', { scenario_id: r.scenario_id }, ctx);
    const head = r.risk_level === 'low'
      ? `Good news: ${money(amount)} to ${to.nickname} is safe. Your lowest projected checking balance is ${money(r.lowest_projected_checking.balance)} on ${fmtDate(r.lowest_projected_checking.date)}.`
      : `Okay, I've set it up even though it's ${riskWord[r.risk_level]}: ${r.headline}`;
    return `${head} ${cap(confirmHint(ctx))} to make the transfer.`;
  }

  const alt = r.safe_alternative_amount;
  let reply = `You can, but heads up. ${r.headline}`;
  if (alt > 0) reply += ` Up to ${money(alt)} keeps you above your ${money(r.safety_threshold)} cushion. Want to compare a smaller amount?`;
  else reply += ` I'd wait until after your paycheck on ${fmtDate(snap.user.nextPayDate)}.`;
  return reply;
}

async function purchaseFlow(text, amount, ctx, { compare = false } = {}) {
  const onCard = /\b(card|credit)\b/i.test(text);
  const what = (text.match(/\b(?:a|an|the)\s+(?:\$?[\d,.]+\s*)?([a-z][a-z \-]{2,24}?)(?:\s+(?:for|on|with|that|costing)\b|[?.!]|$)/i) || [])[1];
  const prev = compare ? await lastScenario(ctx) : null;
  const r = await runTool('simulate_purchase', {
    amount, description: what ? what.trim().replace(/^\w/, (c) => c.toUpperCase()) : 'Purchase', account: onCard ? 'credit card' : 'checking',
  }, ctx);
  if (r.error) return r.error;
  if (prev) await runTool('compare_scenarios', { scenario_ids: [prev.id, r.scenario_id] }, ctx);
  if (onCard) return `${r.headline} Your checking forecast doesn't change until the statement is due.`;
  if (r.risk_level === 'low') return `Yes, you can afford it. ${r.headline}`;
  return `That one's ${riskWord[r.risk_level]}. ${r.headline} Waiting until your paycheck on ${fmtDate(ctx.snap.user.nextPayDate)} would be safer, or put it on your card if you can pay it off then.`;
}

export async function localAgent(message, ctx) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const amount = parseAmount(text);
  const compare = /\bwhat if\b|\binstead\b|\bonly\b|\bjust\b|\bcompare\b/.test(lower);

  // "yes / confirm" with an open pending transfer → remind them to confirm.
  if (/^(yes|yeah|yep|sure|confirm|do it|go ahead|ok(ay)?)\b/.test(lower) && !amount) {
    const last = [...(ctx.conv.messages || [])].reverse().find((m) => m.pendingId);
    if (last) {
      const p = await store.getPending(last.pendingId);
      if (p && p.status === 'pending' && new Date(p.expiresAt) > new Date()) {
        ctx.ui.pending = p;
        return `Your ${money(p.amount)} transfer is ready. ${cap(confirmHint(ctx))} to finish.`;
      }
    }
  }

  if (amount && /\b(transfer|move|send|put|save|pay)\b/.test(lower) && !/\b(buy|purchase|afford)\b/.test(lower)) {
    return transferFlow(text, amount, ctx, { force: /\banyway\b/.test(lower), compare: compare && !/^(ok|okay|yes|go)/.test(lower) });
  }
  if (amount && /\b(buy|purchase|afford|spend|spending|cost|costs|laptop|phone|trip|tv)\b/.test(lower)) {
    return purchaseFlow(text, amount, ctx, { compare });
  }
  if (amount && compare) {
    const prev = await lastScenario(ctx);
    if (prev?.type === 'purchase') return purchaseFlow(text, amount, ctx, { compare: true });
    return transferFlow(text, amount, ctx, { compare: true });
  }
  if (/\bcompare\b/.test(lower)) {
    const r = await runTool('compare_scenarios', {}, ctx);
    if (r.error) return r.error;
    return r.comparison.map((c) => `${c.label}: lowest ${money(c.lowest_checking.balance)} (${riskWord[c.risk_level]})`).join('. ') + '.';
  }
  if (/safe|safely|before (my )?pay|spend (this|until)|how much can i/.test(lower)) {
    const r = await runTool('get_safe_to_spend', {}, ctx);
    return r.amount > 0
      ? `You can safely spend about ${money(r.amount)} before your paycheck on ${fmtDate(r.nextPayDate)}. That keeps checking above ${money(r.threshold)}; your tightest day is ${fmtDate(r.lowestDate)}.`
      : r.explanation;
  }
  if (/health|score|how am i doing|doing financially|financial picture|overall|360/.test(lower)) {
    const h = await runTool('get_financial_health', {}, ctx);
    const weak = h.indicators.filter((i) => i.status !== 'good').map((i) => `${i.label.toLowerCase()} (${i.value})`);
    return `Your financial health score is ${h.score}, ${h.grade.toLowerCase()}. ${weak.length ? `Watch your ${weak.join(' and ')}.` : 'Every indicator is healthy.'} Next step: ${h.focus.tip}`;
  }
  if (/\bbills?\b|\bdue\b|upcoming|\brent\b|obligation/.test(lower)) {
    const r = await runTool('get_upcoming_bills', { days: 30 }, ctx);
    const top = r.bills.slice(0, 3).map((b) => `${b.payee.split(' · ')[0]} ${money(b.amount)} on ${b.due}`).join(', ');
    return `You have ${r.bills.length} bills totaling ${money(r.total)} in the next 30 days. Coming up first: ${top}. Your next paycheck of ${money(r.next_paycheck.amount)} lands ${fmtDate(r.next_paycheck.date)}.`;
  }
  if (/balance|how much (money )?(do )?i have|accounts?\b|net worth|what do i (have|owe)/.test(lower)) {
    const r = await runTool('get_accounts', {}, ctx);
    const chk = r.accounts.find((a) => a.type === 'checking');
    const sav = r.accounts.find((a) => a.type === 'savings');
    let reply = `You have ${money(chk?.balance || 0)} in checking and ${money(sav?.balance || 0)} in savings.`;
    if (/net worth|owe|everything|all/.test(lower)) reply += ` Across all accounts your net worth is ${money(r.net_worth.net)}: ${money(r.net_worth.assets)} in assets and ${money(r.net_worth.liabilities)} owed.`;
    return reply;
  }
  if (/transaction|spent|recent|history|activity/.test(lower)) {
    const r = await runTool('get_recent_transactions', { limit: 4 }, ctx);
    return 'Your latest activity: ' + r.transactions.map((t) => `${t.description} ${money(t.amount)}`).join(', ') + '.';
  }
  if (amount) return transferFlow(text, amount, ctx, { compare });

  return 'I can check balances and bills, tell you what\'s safe to spend, score your financial health, or preview a transfer or purchase before it happens. Try "Transfer $500 to savings" or "Can I afford a $600 laptop?"';
}

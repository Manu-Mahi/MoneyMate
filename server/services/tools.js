import config from '../config.js';
import { findAccount, primaryChecking, daysUntil } from './bank.js';
import { simulate, summarizeScenario, safeToSpend } from './simulator.js';
import { computeHealth } from './health.js';
import * as store from './store.js';
import { fmtDate, money, uid } from '../lib/util.js';

// Backend tools exposed to Gemini (and reused by the local fallback agent).
// They read real numbers from the bank layer and run the simulator; the model
// never computes balances itself. Results for the UI (daily series, pending
// transactions) are collected on ctx.ui and never sent to the model in full.

const S = (type, description, extra = {}) => ({ type, description, ...extra });

export const declarations = [
  {
    name: 'get_accounts',
    description: 'All of the user\'s accounts (checking, savings, credit cards, CDs, IRAs, loans) with balances, plus net worth.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_upcoming_bills',
    description: 'Bills due in the next N days, with payee, amount and due date.',
    parameters: { type: 'OBJECT', properties: { days: S('INTEGER', 'Days ahead to look, default 30') } },
  },
  {
    name: 'get_recent_transactions',
    description: 'Recent transactions, optionally for one account.',
    parameters: {
      type: 'OBJECT',
      properties: { account: S('STRING', 'Account name or type, e.g. "checking"'), limit: S('INTEGER', 'Max rows, default 8') },
    },
  },
  {
    name: 'get_financial_health',
    description: 'Financial health score (0-100) and indicators: cash runway, debt burden, savings rate, credit utilization, debt-to-assets.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_safe_to_spend',
    description: 'How much the user can spend from checking today while staying above their safety cushion for the next 30 days.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'simulate_transfer',
    description: 'Simulate moving money between the user\'s own accounts (including paying a card or loan) and project the 30-day checking balance. Does not move money.',
    parameters: {
      type: 'OBJECT',
      properties: {
        from_account: S('STRING', 'Source account, e.g. "checking"'),
        to_account: S('STRING', 'Destination account, e.g. "savings" or "credit card"'),
        amount: S('NUMBER', 'Amount in USD'),
      },
      required: ['from_account', 'to_account', 'amount'],
    },
  },
  {
    name: 'simulate_purchase',
    description: 'Simulate a purchase and its effect on the 30-day forecast (or on card utilization if paid by credit card). Does not spend money.',
    parameters: {
      type: 'OBJECT',
      properties: {
        amount: S('NUMBER', 'Amount in USD'),
        description: S('STRING', 'What is being bought'),
        account: S('STRING', 'Paying account, default "checking"'),
      },
      required: ['amount'],
    },
  },
  {
    name: 'compare_scenarios',
    description: 'Compare saved scenarios side by side. Omit scenario_ids to compare the two most recent in this conversation.',
    parameters: {
      type: 'OBJECT',
      properties: { scenario_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Scenario ids to compare' } },
    },
  },
  {
    name: 'create_pending_transaction',
    description: 'Prepare a simulated transfer for the user to confirm with the Confirm button. Call ONLY when the user clearly asks to go ahead. No money moves until they confirm.',
    parameters: {
      type: 'OBJECT',
      properties: { scenario_id: S('STRING', 'Id of a simulate_transfer scenario') },
      required: ['scenario_id'],
    },
  },
];

function accountView(a) {
  const v = { id: a.id, name: a.nickname, type: a.type, mask: a.mask, balance: a.balance, owed: a.kind === 'liability' };
  if (a.limit) v.limit = a.limit;
  if (a.apr) v.apr = a.apr;
  if (a.apy) v.apy = a.apy;
  if (a.monthlyPayment) v.monthly_payment = a.monthlyPayment;
  return v;
}

export function makeContext({ snap, conv, userId, channel = 'web' }) {
  return { snap, conv, userId, channel, ui: { scenarios: [], comparison: null, pending: null }, scenarios: new Map(), trace: [] };
}

// How the user confirms on this channel: a button on the web, a spoken or
// texted "yes" everywhere else.
export const confirmHint = (ctx) => {
  if (ctx.channel === 'web') return 'press Confirm';
  if (config.transferPin) return ctx.channel === 'voice' ? 'say their 4-digit PIN' : 'reply with their 4-digit PIN';
  return ctx.channel === 'voice' ? 'say yes' : 'reply YES';
};

async function loadScenario(ctx, id) {
  return ctx.scenarios.get(id) || (await store.getScenario(id));
}

async function remember(ctx, sc) {
  ctx.scenarios.set(sc.id, sc);
  ctx.ui.scenarios.push(sc);
  ctx.conv.lastScenarioIds = [...(ctx.conv.lastScenarioIds || []), sc.id].slice(-5);
  await store.saveScenario(sc, { userId: ctx.userId, conversationId: ctx.conv._id });
}

export const handlers = {
  async get_accounts(_, ctx) {
    const { snap } = ctx;
    const h = computeHealth(snap);
    return { accounts: snap.accounts.map(accountView), net_worth: h.netWorth, data_source: snap.source };
  },

  async get_upcoming_bills({ days = 30 } = {}, ctx) {
    const bills = ctx.snap.bills
      .map((b) => ({ payee: b.payee, amount: b.amount, due_date: b.dueDate, due: fmtDate(b.dueDate), in_days: daysUntil(b.dueDate) }))
      .filter((b) => b.in_days >= 0 && b.in_days <= days)
      .sort((a, b) => a.in_days - b.in_days);
    return { bills, total: bills.reduce((s, b) => s + b.amount, 0), next_paycheck: { date: ctx.snap.user.nextPayDate, amount: ctx.snap.user.payAmount } };
  },

  async get_recent_transactions({ account, limit = 8 } = {}, ctx) {
    const acct = account ? findAccount(ctx.snap, account) : null;
    const rows = ctx.snap.transactions.filter((t) => !acct || t.accountId === acct.id).slice(0, limit);
    return { transactions: rows.map((t) => ({ date: t.date, description: t.description, amount: t.amount, account: ctx.snap.accounts.find((a) => a.id === t.accountId)?.nickname })) };
  },

  async get_financial_health(_, ctx) {
    const h = computeHealth(ctx.snap);
    return {
      score: h.score, grade: h.grade,
      indicators: h.indicators.map(({ label, display, status, explain }) => ({ label, value: display, status, explain })),
      focus: h.focus, monthly: h.monthly,
    };
  },

  async get_safe_to_spend(_, ctx) {
    return safeToSpend(ctx.snap);
  },

  async simulate_transfer({ from_account, to_account, amount }, ctx) {
    const from = findAccount(ctx.snap, from_account || 'checking');
    const to = findAccount(ctx.snap, to_account);
    amount = Number(amount);
    if (!from || !to) return { error: `Could not find account "${!from ? from_account : to_account}". Available: ${ctx.snap.accounts.map((a) => a.nickname).join(', ')}` };
    if (from.id === to.id) return { error: 'Source and destination are the same account.' };
    if (from.kind !== 'asset') return { error: `${from.nickname} is not a cash account.` };
    if (!(amount > 0)) return { error: 'Amount must be greater than zero.' };
    if (amount > from.balance) return { error: `${from.nickname} only has ${money(from.balance)}.` };
    const verb = to.kind === 'liability' ? 'Pay' : 'Transfer';
    const sc = simulate(ctx.snap, {
      type: 'transfer', amount, fromId: from.id, toId: to.id,
      label: `${verb} ${money(amount)} ${from.nickname} → ${to.nickname}`,
    });
    await remember(ctx, sc);
    return summarizeScenario(sc);
  },

  async simulate_purchase({ amount, description = 'Purchase', account = 'checking' }, ctx) {
    const acct = findAccount(ctx.snap, account) || primaryChecking(ctx.snap);
    amount = Number(amount);
    if (!(amount > 0)) return { error: 'Amount must be greater than zero.' };
    if (acct.kind === 'asset' && acct.type !== 'checking') return { error: 'Purchases can be simulated on checking or a credit card.' };
    const sc = simulate(ctx.snap, {
      type: 'purchase', amount, accountId: acct.id,
      label: `${description} ${money(amount)} on ${acct.nickname}`,
    });
    await remember(ctx, sc);
    return summarizeScenario(sc);
  },

  async compare_scenarios({ scenario_ids } = {}, ctx) {
    const ids = scenario_ids?.length ? scenario_ids : (ctx.conv.lastScenarioIds || []).slice(-2);
    const list = (await Promise.all(ids.map((id) => loadScenario(ctx, id)))).filter(Boolean);
    if (list.length < 2) return { error: 'Need at least two scenarios to compare. Simulate another option first.' };
    ctx.ui.comparison = list;
    return {
      comparison: list.map((sc) => ({
        scenario_id: sc.id, label: sc.label, risk_level: sc.riskLevel,
        lowest_checking: sc.scenario.lowest, checking_on_day_30: sc.scenario.endBalance,
        balances_after: sc.impacts, headline: sc.headline,
      })),
    };
  },

  async create_pending_transaction({ scenario_id }, ctx) {
    const sc = await loadScenario(ctx, scenario_id);
    if (!sc) return { error: 'Unknown scenario_id. Simulate the transfer first.' };
    if (sc.type !== 'transfer') return { error: 'Only transfers can be executed; purchases are what-if only.' };
    const p = {
      _id: uid('p'),
      userId: ctx.userId,
      scenarioId: sc.id,
      fromId: sc.action.fromId,
      toId: sc.action.toId,
      amount: sc.amount,
      label: sc.label,
      channel: ctx.channel,
      status: 'pending',
      expiresAt: new Date(Date.now() + config.pendingTtlMinutes * 60000),
      summary: {
        from: sc.from, to: sc.to, amount: sc.amount, riskLevel: sc.riskLevel,
        lowest: sc.scenario.lowest, headline: sc.headline, impacts: sc.impacts,
      },
    };
    await store.createPending(p);
    ctx.ui.pending = p;
    return { pending_id: p._id, status: 'awaiting_user_confirmation', note: `Tell the user to ${confirmHint(ctx)} to finish. You cannot execute it yourself.` };
  },
};

export async function runTool(name, args, ctx) {
  const fn = handlers[name];
  ctx.trace.push(name);
  if (!fn) return { error: `Unknown tool ${name}` };
  try {
    return await fn(args || {}, ctx);
  } catch (err) {
    console.error(`[tool ${name}]`, err);
    return { error: err.message };
  }
}

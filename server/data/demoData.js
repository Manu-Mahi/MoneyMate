import config from '../config.js';
import { startOfToday, addDays, iso } from '../lib/util.js';

// Synthetic persona used when Nessie is not configured or unreachable.
// Every date is relative to today so the demo always lines up:
// rent hits in 5 days, the next paycheck lands in 12.
export function buildDemoData(today = startOfToday()) {
  const d = (n) => iso(addDays(today, n));

  const user = {
    id: 'DEMO-001',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    payAmount: 2000, // net per paycheck
    payFrequencyDays: 14,
    nextPayDate: d(12),
    employer: 'Brightline Logistics',
    dailySpend: 15, // average discretionary spend (groceries, gas, coffee)
    safetyThreshold: config.safetyThreshold,
  };

  const accounts = [
    { id: 'chk', type: 'checking', nickname: 'Everyday Checking', mask: '4821', balance: 2500, kind: 'asset', source: 'synthetic' },
    { id: 'sav', type: 'savings', nickname: 'High-Yield Savings', mask: '9013', balance: 1000, kind: 'asset', apy: 4.0, source: 'synthetic' },
    { id: 'cc', type: 'credit_card', nickname: 'Rewards Credit Card', mask: '3307', balance: 1240, limit: 5000, apr: 22.9, kind: 'liability', source: 'synthetic' },
    { id: 'cd', type: 'cd', nickname: '12-Month CD', mask: '5510', balance: 8000, apy: 4.1, maturity: d(140), kind: 'asset', source: 'linked' },
    { id: 'ira', type: 'ira', nickname: 'Roth IRA', mask: '7781', balance: 18400, kind: 'asset', source: 'linked' },
    { id: 'auto', type: 'auto_loan', nickname: 'Auto Loan', mask: '2264', balance: 14200, apr: 6.4, monthlyPayment: 385, kind: 'liability', source: 'synthetic' },
    { id: 'student', type: 'student_loan', nickname: 'Student Loan', mask: '6630', balance: 12800, apr: 5.5, monthlyPayment: 230, kind: 'liability', source: 'linked' },
  ];

  const bills = [
    { id: 'b-rent', payee: 'Rent · Maple Court Apts', amount: 1800, dueDate: d(5), category: 'housing', accountId: 'chk' },
    { id: 'b-elec', payee: 'City Electric', amount: 120, dueDate: d(8), category: 'utilities', accountId: 'chk' },
    { id: 'b-auto', payee: 'Auto Loan Payment', amount: 385, dueDate: d(13), category: 'debt', accountId: 'chk', linkedAccountId: 'auto' },
    { id: 'b-phone', payee: 'Mobile Phone', amount: 65, dueDate: d(14), category: 'utilities', accountId: 'chk' },
    { id: 'b-stream', payee: 'Streaming Bundle', amount: 15.49, dueDate: d(16), category: 'subscription', accountId: 'chk' },
    { id: 'b-cc', payee: 'Credit Card Minimum', amount: 45, dueDate: d(18), category: 'debt', accountId: 'chk', linkedAccountId: 'cc' },
    { id: 'b-student', payee: 'Student Loan Payment', amount: 230, dueDate: d(22), category: 'debt', accountId: 'chk', linkedAccountId: 'student' },
    { id: 'b-net', payee: 'Home Internet', amount: 60, dueDate: d(25), category: 'utilities', accountId: 'chk' },
    { id: 'b-gym', payee: 'Gym Membership', amount: 35, dueDate: d(27), category: 'subscription', accountId: 'chk' },
  ];

  const transactions = [
    { id: 't1', accountId: 'chk', date: d(0), description: 'Morning Coffee', amount: -6.5, category: 'dining' },
    { id: 't2', accountId: 'chk', date: d(-1), description: 'Gas Station', amount: -42, category: 'transport' },
    { id: 't3', accountId: 'chk', date: d(-2), description: 'Salary Deposit · Brightline', amount: 2000, category: 'income' },
    { id: 't4', accountId: 'chk', date: d(-2), description: 'Groceries · FreshMart', amount: -85, category: 'groceries' },
    { id: 't5', accountId: 'cc', date: d(-3), description: 'Dinner · Olive & Oak', amount: -38, category: 'dining' },
    { id: 't6', accountId: 'chk', date: d(-4), description: 'Pharmacy', amount: -24, category: 'health' },
    { id: 't7', accountId: 'chk', date: d(-6), description: 'Transfer to Savings', amount: -200, category: 'transfer' },
    { id: 't8', accountId: 'sav', date: d(-6), description: 'Transfer from Checking', amount: 200, category: 'transfer' },
    { id: 't9', accountId: 'cc', date: d(-8), description: 'Online Order · Home Goods', amount: -64, category: 'shopping' },
    { id: 't10', accountId: 'chk', date: d(-10), description: 'Groceries · FreshMart', amount: -92, category: 'groceries' },
  ];

  return { user, accounts, bills, transactions };
}

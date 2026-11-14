import test from 'node:test';
import assert from 'node:assert/strict';
import { recurringAnalysis } from './analysisRecurring.ts';
import { analysisColumns } from './analysisSnapshot.ts';

const snapshot = bills => ({
  householdId: 'fictional-household',
  today: '2026-09-10',
  capturedAt: '2026-09-10T16:00:00Z',
  timeZone: 'UTC',
  sources: Object.fromEntries(Object.keys(analysisColumns).map(table => [table, {
    rows: table === 'bills' ? bills : [], complete: true,
  }])),
});
const request = patch => ({
  domain: 'subscriptions', operation: 'summary', purpose: 'general', dateEvent: 'none',
  amount: null, startDate: null, endDate: null, entity: null, merchant: null, category: null,
  ...patch,
});
const bill = (id, amount, patch = {}) => ({
  id, name: `Service ${id}`, amount, category: 'Other', frequency: 'monthly',
  due_day: 15, start_date: '2026-09-01', is_debt: false, is_recurring: true,
  balance: 0, interest_rate: 0, ...patch,
});

test('manual subscription choices take priority over category clues', () => {
  const result = recurringAnalysis(snapshot([
    bill('custom', 25, { is_subscription: true }),
    bill('regular', 90, { category: 'Subscriptions', is_subscription: false }),
    bill('automatic', 10, { category: 'Streaming', is_subscription: null }),
    bill('legacy', 15, { category: 'Software' }),
    bill('not-categorized', 40, { name: 'Netflix', is_subscription: null }),
  ]), request());
  assert.equal(result.facts.configuredSubscriptionMonthlyCost, 50);
  assert.equal(result.facts.configuredObligations, 50);
  assert.equal(result.facts.occurrenceCount, 3);
  assert.match(result.text, /Configured subscription bills total about \$50\.00\/month/);
});

test('explicit subscriptions still respect debt, recurrence, and active dates', () => {
  const result = recurringAnalysis(snapshot([
    bill('active', 25, { name: 'Custom club', is_subscription: true }),
    bill('debt', 80, { name: 'Custom debt', is_subscription: true, is_debt: true, balance: 800 }),
    bill('one-time', 75, { name: 'Custom purchase', is_subscription: true, is_recurring: false }),
    bill('future', 65, { name: 'Custom future', is_subscription: true, start_date: '2026-10-01' }),
    bill('ended', 55, { name: 'Custom ended', is_subscription: true, end_date: '2026-09-09' }),
  ]), request());
  assert.equal(result.facts.configuredSubscriptionMonthlyCost, 25);
  assert.equal(result.facts.configuredObligations, 25);
  assert.equal(result.facts.occurrenceCount, 1);
});

test('manual classification keeps the existing exact named source schedule scope', () => {
  const result = recurringAnalysis(snapshot([
    bill('custom', 25, { name: 'Custom club', is_subscription: true }),
    bill('other', 45, { name: 'Other club', is_subscription: true }),
  ]), request({ entity: 'Custom club' }));
  assert.equal(result.facts.configuredSubscriptionMonthlyCost, 25);
  assert.equal(result.facts.configuredObligations, 25);
  assert.equal(result.facts.occurrenceCount, 1);
});

test('manual classification does not change bill payment cadence or monthly equivalents', () => {
  const result = recurringAnalysis(snapshot([
    bill('annual', 120, { is_subscription: true, frequency: 'yearly', next_payment_date: '2026-11-15' }),
    bill('quarterly', 30, { is_subscription: true, frequency: 'quarterly', next_payment_date: '2026-11-15' }),
  ]), request({ endDate: '2026-12-31' }));
  assert.equal(result.facts.configuredSubscriptionMonthlyCost, 20);
  assert.equal(result.facts.configuredObligations, 150);
  assert.equal(result.facts.occurrenceCount, 2);
});

test('scoped analysis snapshot explicitly reads the subscription preference', () => {
  assert.equal(analysisColumns.bills.split(',').filter(column => column === 'is_subscription').length, 1);
  assert.ok(!analysisColumns.bills.split(',').includes('*'));
});

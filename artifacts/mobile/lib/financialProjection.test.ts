import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import golden from "./financialProjection.golden.json";
import { createFinancialProjection } from "./financialProjection";
import { createFinancialProjectionReader } from "./financialProjectionReader";
import type { FinancialProjectionSnapshot } from "./financialProjectionTypes";
import {
  accountAwareTransactionCollections,
  normalizeBillRow,
  normalizeConnectedBankRows,
  normalizeMonthlyOverrideRow,
  normalizeTransactionRow,
} from "./financialProjectionInput";

test("edited John payday anchor counts September deposits once, not planned plus actual", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.bills = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.settings.starting_balance = 0;
  snapshot.incomes = [{
    id: "john", name: "John", amount: 2425.36, frequency: "biweekly",
    start_date: "2026-09-02", next_payment_date: "2026-09-02",
  }];
  snapshot.transactions = [
    ["2026-09-02", "2026-09-04"],
    ["2026-09-16", "2026-09-18"],
    ["2026-09-30", "2026-10-02"],
  ].map(([date, occurrenceDate], index) => ({
    id: `john-${index}`, date, amount: 2425.36, category: "Income", note: "John paycheck",
    source: "statement", review_status: "matched", review_resolution: "income",
    review_allocations: [{ type: "income", targetId: "john", occurrenceDate, amount: 2425.36, settlement: "exact" }],
  }));
  const before = JSON.stringify(snapshot.transactions);
  const projection = createFinancialProjection(snapshot, {
    now: new Date("2026-10-01T12:00:00Z"), timeZone: "America/Chicago",
  });
  const cashFlow = projection.getCashFlow(8, 2026);
  assert.equal(cashFlow.monthlyIncome, 0);
  assert.equal(cashFlow.netTransactions, 7276.08);
  assert.equal(cashFlow.remaining, 7276.08);
  const days = projection.getDailyBalances(8, 2026);
  const events = days.flatMap(day => day.events ?? []);
  assert.equal(days.at(-1)?.balance, 7276.08);
  assert.equal(events.filter(event => event.kind === "scheduled_income" && event.sourceId === "john").length, 0);
  assert.equal(events.filter(event => event.kind === "transaction_income" && event.sourceId.startsWith("john-")).length, 3);
  assert.equal(JSON.stringify(snapshot.transactions), before, "stored occurrence dates remain untouched");
});

test("explicit distant payday match stays in its selected month", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.bills = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.settings.starting_balance = 0;
  snapshot.incomes = [{ id: "pay", name: "Pay", amount: 100, frequency: "monthly", start_date: "2026-09-01", next_payment_date: "2026-09-01" }];
  snapshot.transactions = [{
    id: "deposit", date: "2026-09-20", amount: 100, category: "Income", note: "Pay",
    source: "statement", review_status: "matched", review_resolution: "income",
    review_allocations: [{ type: "income", targetId: "pay", occurrenceDate: "2026-09-01", amount: 100, settlement: "exact" }],
  }];
  const projection = createFinancialProjection(snapshot, {
    now: new Date("2026-09-21T12:00:00Z"), timeZone: "America/Chicago",
  });
  assert.equal(projection.getCashFlow(8, 2026).monthlyIncome, 0);
  assert.equal(projection.getCashFlow(9, 2026).monthlyIncome, 100);
  assert.equal(projection.getDailyBalances(8, 2026).flatMap(day => day.events ?? []).filter(event => event.kind === "scheduled_income" && event.sourceId === "pay").length, 0);
  assert.equal(projection.getDailyBalances(9, 2026).flatMap(day => day.events ?? []).filter(event => event.kind === "scheduled_income" && event.sourceId === "pay").length, 1);
});

test("malformed saved bill amounts cannot poison the forecast", () => {
  const bill = normalizeBillRow({
    id: "utility",
    name: "Utility",
    amount: "NaN",
    balance: "NaN",
    interest_rate: "NaN",
    category: "Utilities",
    priority: 1,
    is_debt: false,
    due_day: 10,
    is_recurring: true,
    created_at: "2026-09-01T00:00:00.000Z",
  });
  const override = normalizeMonthlyOverrideRow({
    id: "override",
    bill_id: bill.id,
    month: 9,
    year: 2026,
    custom_amount: "NaN",
    paid_amount: "NaN",
    actual_amount: "NaN",
  });

  assert.equal(bill.amount, 0);
  assert.equal(bill.balance, 0);
  assert.equal(override.custom_amount, undefined);
  assert.equal(override.paid_amount, 0);
});

for (const fixture of golden.cases) {
  test(`legacy BudgetContext parity: ${fixture.name}`, () => {
    const snapshot = structuredClone(
      fixture.snapshot,
    ) as unknown as FinancialProjectionSnapshot;
    const before = JSON.stringify(snapshot);
    const projection = createFinancialProjection(snapshot, {
      now: new Date(golden.now),
      timeZone: golden.timeZone,
    });
    const result = [8, 9, 10].map((month) => ({
      month,
      cashFlow: projection.getCashFlow(month, 2026),
      daily: projection.getDailyBalances(month, 2026),
      debtPlan: projection.getDebtPlanForMonth(month, 2026),
      remainingDebtPlan: projection.getRemainingDebtPlanForMonth(month, 2026),
      occurrences: snapshot.bills.map((bill) => [
        bill.id,
        projection.getBillOccurrencesInMonth(bill, month, 2026),
      ]),
    }));
    assert.equal(
      createHash("sha256").update(JSON.stringify(result)).digest("hex"),
      fixture.expectedHash,
    );
    assert.equal(
      JSON.stringify(snapshot),
      before,
      "reads do not mutate household input",
    );
    assert.equal(
      projection.getDailyBalances(8, 2026),
      result[0].daily,
      "same revision reuses daily array",
    );
    assert.equal(projection.getCashFlow(8, 2026), result[0].cashFlow);
  });
}

test("one injected clock respects household month boundaries and does not drift", () => {
  const snapshot = structuredClone(
    golden.cases[0].snapshot,
  ) as unknown as FinancialProjectionSnapshot;
  const now = new Date("2026-10-01T02:00:00Z");
  const chicago = createFinancialProjection(snapshot, {
    now,
    timeZone: "America/Chicago",
  });
  const tokyo = createFinancialProjection(snapshot, {
    now,
    timeZone: "Asia/Tokyo",
  });
  now.setUTCFullYear(2030);
  assert.ok(chicago.getDebtPlanForMonth(8, 2026));
  assert.equal(tokyo.getDebtPlanForMonth(8, 2026), null);
  assert.throws(
    () =>
      createFinancialProjection(snapshot, {
        now: new Date(NaN),
        timeZone: "UTC",
      }),
    /valid projection clock/,
  );
});

test("lazy revision reader avoids startup work and advances only when an existing dated read crosses midnight", () => {
  const snapshot = structuredClone(
    golden.cases[0].snapshot,
  ) as unknown as FinancialProjectionSnapshot;
  let now = new Date("2026-10-01T02:00:00Z");
  let reads = 0;
  const reader = createFinancialProjectionReader(snapshot, {
    now: () => {
      reads++;
      return now;
    },
    timeZone: "America/Chicago",
  });
  assert.equal(reads, 0);
  const callback = reader.getDailyBalances;
  const september = callback(8, 2026);
  assert.equal(callback, reader.getDailyBalances);
  assert.equal(reader.getDailyBalances(8, 2026), september);
  const beforeAmountReads = reads;
  for (let i = 0; i < 50; i++) reader.getAmount(snapshot.bills[0], 8, 2026);
  assert.equal(
    reads,
    beforeAmountReads,
    "non-dated lookups do not format the timezone on each call",
  );
  now = new Date("2026-10-01T06:00:00Z");
  assert.equal(reader.getDebtPlanForMonth(8, 2026), null);
  assert.notEqual(reader.getDailyBalances(8, 2026), september);
});

test("shared normalizers preserve required snapshots, allocations, account identities and unknown bank flags", () => {
  assert.equal(
    normalizeMonthlyOverrideRow({
      paid_amount: "35",
      required_debt_amount: "35",
      planned_debt_amount: "60",
      custom_amount: null,
    }).required_debt_amount,
    35,
  );
  const transaction = normalizeTransactionRow({
    id: "review",
    amount: "-35",
    review_allocations: [
      {
        type: "bill",
        amount: "35",
        plannedAmount: "60",
        settlement: "partial",
      },
    ],
  });
  assert.equal(transaction.review_allocations?.[0].plannedAmount, 60);
  const identities = normalizeConnectedBankRows([
    {
      id: "bank",
      plaid_account_id: "pa",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: null,
      is_active: false,
    },
  ]);
  assert.equal(identities[0].current_balance_available, false);
  const collections = accountAwareTransactionCollections(
    [
      {
        id: "old",
        date: "2026-09-01",
        amount: -10,
        source: "plaid",
        plaid_account_id: "pa",
        deleted_at: "2026-09-02",
      },
    ],
    identities,
  );
  assert.equal(collections.deleted.length, 1);
  assert.equal(collections.unknownPlaid.length, 0);
});

test("shared engine has no React, auth, storage, network or un-injected current clock", () => {
  const source = readFileSync(
    join(process.cwd(), "lib", "financialProjection.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from ["']react|supabase|recordDiagnostic|new Date\(\)|Date.now\(\)|useMemo|useCallback/,
  );
  assert.match(golden.capturedFrom, /Unmodified BudgetContext callbacks/);
  assert.match(golden.legacyCommit, /^316845d[0-9a-f]{33}$/);
});

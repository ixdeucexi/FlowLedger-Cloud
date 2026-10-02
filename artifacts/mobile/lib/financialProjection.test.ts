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
  normalizeStoredBillDateMoves,
  normalizeTransactionRow,
} from "./financialProjectionInput";

function bankObligationFixture(anchorDate = "2026-10-02"): FinancialProjectionSnapshot {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.bills = [{ ...snapshot.bills[0], id: "bill", name: "Bill", amount: 100, due_day: 2, start_date: "2026-01-01" }];
  snapshot.incomes = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.transactions = [];
  snapshot.overrides = [];
  snapshot.billDateMoves = [];
  snapshot.extraPayments = [];
  snapshot.accounts = [];
  snapshot.connectedBankAccounts = [{ id: "bank", name: "Checking", current_balance: 1000, is_active: true, account_type: "depository", account_subtype: "checking", updated_at: `${anchorDate}T12:00:00Z` }];
  snapshot.settings.starting_balance = 1000;
  snapshot.settings.starting_balance_date = "2026-01-01";
  snapshot.settings.debtPayoffEnabled = false;
  return snapshot;
}

test("bank-month closing seeds following months including anchor-day obligations and year boundaries", () => {
  for (const [anchor, month, year, nextMonth, nextYear] of [["2026-10-02", 9, 2026, 10, 2026], ["2026-12-02", 11, 2026, 0, 2027]] as const) {
    const snapshot = bankObligationFixture(anchor);
    snapshot.incomes = [{ id: "pay", name: "Pay", amount: 200, frequency: "monthly", start_date: anchor, next_payment_date: anchor }];
    const projection = createFinancialProjection(snapshot, { now: new Date(`${anchor}T12:00:00Z`), timeZone: "America/Chicago" });
    const days = projection.getDailyBalances(month, year);
    assert.equal(days[1].balance, 1100);
    assert.equal(days.at(-1)?.balance, 1100);
    assert.equal(projection.getDailyBalances(nextMonth, nextYear)[0].balance, 1100);
    assert.equal(projection.getDailyBalances(nextMonth, nextYear).at(-1)?.balance, 1200);
  }
});

test("bank refresh keeps only unpaid occurrence remainder and preserves the original calendar day", () => {
  for (const [settlement, paid, expected] of [["partial", 40, 940], ["full", 40, 1000], ["exact", 100, 1000]] as const) {
    const snapshot = bankObligationFixture();
    snapshot.bills[0].due_day = 1;
    snapshot.transactions = [{ id: "paid", date: "2026-10-01", amount: -paid, category: "Bills", note: "Bill", source: "statement", review_status: "matched", review_resolution: "bill", review_allocations: [{ type: "bill", targetId: "bill", occurrenceDate: "2026-10-01", amount: paid, plannedAmount: 100, settlement }] }];
    const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" });
    const days = projection.getDailyBalances(9, 2026);
    assert.equal(days[1].balance, expected);
    assert.equal(projection.getDailyBalances(10, 2026)[0].balance, expected - 100);
    if (settlement === "partial") assert.ok(days[0].events?.some(item => item.kind === "bill" && item.amount === -60));
  }
});

test("legacy dated payment only closes its weekly occurrence and leaves later dates reserved", () => {
  const snapshot = bankObligationFixture("2026-10-09");
  snapshot.bills[0] = { ...snapshot.bills[0], frequency: "weekly", day_of_week: 5, start_date: "2026-10-02", next_payment_date: "2026-10-02" };
  snapshot.overrides = [{ id: "paid", bill_id: "bill", month: 9, year: 2026, paid_amount: 500, paid_date: "2026-10-02" }];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-09T12:00:00Z"), timeZone: "America/Chicago" });
  const days = projection.getDailyBalances(9, 2026);
  assert.equal(days[8].balance, 900);
  assert.equal(days.at(-1)?.balance, 600);
  assert.equal(projection.getDailyBalances(10, 2026)[0].balance, 600);
});

test("finalized legacy paid bill is not reserved a second time after refresh", () => {
  const snapshot = bankObligationFixture();
  snapshot.bills[0].due_day = 1;
  snapshot.overrides = [{ id: "paid", bill_id: "bill", month: 9, year: 2026, paid_amount: 80, paid_date: "2026-10-01", actual_amount: 80 }];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" });
  assert.equal(projection.getDailyBalances(9, 2026)[1].balance, 1000);
  assert.equal(projection.getDailyBalances(10, 2026)[0].balance, 900);
});

test("manual account observations preserve unpaid bills instead of silently paying them", () => {
  for (const [paid, expected] of [[0, 900], [40, 940], [100, 1000]] as const) {
    const snapshot = bankObligationFixture();
    snapshot.bills[0].due_day = 1;
    snapshot.connectedBankAccounts = [];
    snapshot.accounts = [{ id: "cash", name: "Checking", account_type: "checking", current_balance: 1000, balance_as_of: "2026-10-02", is_active: true, created_at: "2026-01-01T12:00:00Z" }];
    snapshot.overrides = [{ id: "legacy", bill_id: "bill", month: 9, year: 2026, paid_amount: paid, paid_date: "2026-10-01" }];
    const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" });
    assert.equal(projection.getDailyBalances(9, 2026)[1].balance, expected);
    assert.equal(projection.getDailyBalances(10, 2026)[0].balance, expected - 100);
  }
});

test("overdue canonical debt minimum remains reserved and rolls forward once", () => {
  const snapshot = bankObligationFixture();
  snapshot.settings.debtPayoffEnabled = true;
  snapshot.bills[0] = { ...snapshot.bills[0], is_debt: true, balance: 500, interest_rate: 0, due_day: 1 };
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" });
  const days = projection.getDailyBalances(9, 2026);
  assert.equal(days[1].balance, 900);
  assert.equal(days.at(-1)?.balance, 900);
  assert.equal(projection.getDailyBalances(10, 2026)[0].balance, 800);
  assert.ok(days[0].events?.some(item => item.debtPlanAllocationKind === "required" && item.amount === -100));
});

test("legacy partial payment in a future month agrees with subsequent carryover", () => {
  const snapshot = bankObligationFixture();
  snapshot.overrides = [{ id: "future-partial", bill_id: "bill", month: 10, year: 2026, paid_amount: 40, paid_date: "2026-11-02" }];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-10-02T12:00:00Z"), timeZone: "America/Chicago" });
  assert.equal(projection.getDailyBalances(10, 2026).at(-1)?.balance, 840);
  assert.equal(projection.getDailyBalances(11, 2026)[0].balance, 840);
});

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

test("cold-cache bill exceptions retain amount, skip and freshness fields", () => {
  const moves = normalizeStoredBillDateMoves([{
    id: "cached", bill_id: "weekly", from_date: "2026-09-09T00:00:00Z", to_date: "2026-09-10",
    custom_amount: "44.50", is_skipped: true, updated_at: "2026-09-08T12:00:00Z",
    created_at: "2026-09-01T12:00:00Z",
  }]);
  assert.deepEqual(moves, [{
    id: "cached", bill_id: "weekly", from_date: "2026-09-09", to_date: "2026-09-10",
    custom_amount: 44.5, is_skipped: true, move_reason: "manual",
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-08T12:00:00Z",
  }]);
});

test("weekly occurrence exceptions change one amount and skip one date without changing siblings", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.settings.starting_balance = 1000;
  snapshot.incomes = [];
  snapshot.transactions = [];
  snapshot.deletedTransactions = [];
  snapshot.goals = [];
  snapshot.decisions = [];
  snapshot.extraPayments = [];
  snapshot.overrides = [];
  snapshot.bills = [{
    id: "weekly", name: "Weekly bill", amount: 25, category: "Other", priority: 1,
    is_debt: false, balance: 0, interest_rate: 0, due_day: 2, day_of_week: 3,
    next_payment_date: "2026-09-02", start_date: "2026-09-02", is_recurring: true,
    frequency: "weekly", created_at: "2026-09-01T00:00:00Z",
  }];
  snapshot.billDateMoves = [
    { id: "amount", bill_id: "weekly", from_date: "2026-09-09", to_date: "2026-09-09", custom_amount: 40, created_at: "2026-09-01T00:00:00Z" },
    { id: "skip", bill_id: "weekly", from_date: "2026-09-16", to_date: "2026-09-16", is_skipped: true, created_at: "2026-09-01T00:00:00Z" },
  ];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-09-01T12:00:00Z"), timeZone: "America/Chicago" });

  assert.deepEqual(projection.getBillOccurrencesInMonth(snapshot.bills[0], 8, 2026), [2, 9, 23, 30]);
  assert.equal(projection.getBillOccurrenceAmount(snapshot.bills[0], "2026-09-09"), 40);
  assert.equal(projection.getBillOccurrenceAmount(snapshot.bills[0], "2026-09-23"), 25);
  assert.equal(projection.getBillMonthlyTotal(snapshot.bills[0], 8, 2026), 115);
  const billEvents = projection.getDailyBalances(8, 2026).flatMap(day => day.events ?? []).filter(event => event.sourceId === "weekly");
  assert.deepEqual(billEvents.map(event => [event.date, event.amount]), [
    ["2026-09-02", -25], ["2026-09-09", -40], ["2026-09-23", -25], ["2026-09-30", -25],
  ]);
});

test("ending a series ignores moved and custom exceptions on the selected and later occurrences", () => {
  const snapshot = structuredClone(golden.cases[0].snapshot) as unknown as FinancialProjectionSnapshot;
  snapshot.settings.starting_balance = 500;
  snapshot.incomes = []; snapshot.transactions = []; snapshot.deletedTransactions = [];
  snapshot.goals = []; snapshot.decisions = []; snapshot.extraPayments = []; snapshot.overrides = [];
  snapshot.bills = [{
    id: "weekly", name: "Weekly", amount: 25, category: "Other", priority: 1, is_debt: false,
    balance: 0, interest_rate: 0, due_day: 2, day_of_week: 3, next_payment_date: "2026-09-02",
    start_date: "2026-09-02", end_date: "2026-09-08", is_recurring: true, frequency: "weekly",
    created_at: "2026-09-01T00:00:00Z",
  }];
  snapshot.billDateMoves = [
    { id: "selected", bill_id: "weekly", from_date: "2026-09-09", to_date: "2026-09-20", custom_amount: 40, created_at: "2026-09-01T00:00:00Z" },
    { id: "later", bill_id: "weekly", from_date: "2026-09-16", to_date: "2026-09-16", custom_amount: 55, created_at: "2026-09-01T00:00:00Z" },
  ];
  const projection = createFinancialProjection(snapshot, { now: new Date("2026-09-01T12:00:00Z"), timeZone: "America/Chicago" });
  assert.deepEqual(projection.getBillOccurrencesInMonth(snapshot.bills[0], 8, 2026), [2]);
  assert.equal(projection.getBillMonthlyTotal(snapshot.bills[0], 8, 2026), 25);
  assert.deepEqual(
    projection.getDailyBalances(8, 2026).flatMap(day => day.events ?? []).filter(event => event.sourceId === "weekly").map(event => event.date),
    ["2026-09-02"],
  );
});

// The original capture dropped unpaid Rent ($900) at bank refresh. Keep that
// provenance intact while auditing the corrected bank-anchored expectations.
const obligationReserveCorrections: Record<string, { hash: string; endings: number[] }> = {
  "connected-anchor-deleted-posted-reviewed-income": { hash: "178e8b438a8efca4a50326c2354ab546d82a1490cadc6927a8dfeb62848a49ee", endings: [1140, 3355, 5570] },
  "pending-matched-debt-no-double-charge": { hash: "a1a02d96a745b888f2ff189bf0247355fe480bd01a463ff3a273b5dd964fcb02", endings: [1140, 3355, 5570] },
  "manual-anchor-transfer-preservation": { hash: "0dd6daa375ecf9b924ffd72b76cb49218c023aa375f06e64f1ffe88adc3f9414", endings: [1348, 3563, 5778] },
};

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
      obligationReserveCorrections[fixture.name]?.hash ?? fixture.expectedHash,
    );
    const correction = obligationReserveCorrections[fixture.name];
    if (correction) assert.deepEqual(result.map(month => month.daily.at(-1)?.balance), correction.endings);
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

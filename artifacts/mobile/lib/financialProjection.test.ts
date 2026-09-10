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
  normalizeConnectedBankRows,
  normalizeMonthlyOverrideRow,
  normalizeTransactionRow,
} from "./financialProjectionInput";

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

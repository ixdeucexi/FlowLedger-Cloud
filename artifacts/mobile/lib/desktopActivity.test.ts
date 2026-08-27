import assert from "node:assert/strict";
import test from "node:test";

import {
  countsInDisplayedCashFlow,
  groupDisplayedActivityByDate,
  summarizeDisplayedActivity,
} from "./desktopActivity";

test("visible Activity totals exclude pending cash and transfer movement", () => {
  assert.deepEqual(
    summarizeDisplayedActivity([
      { amount: 1200, source: "income", countsInCashFlow: true },
      {
        amount: -325.5,
        source: "bank_transaction",
        countsInCashFlow: true,
      },
      { amount: -200, source: "transfer", countsInCashFlow: false },
      {
        amount: -40,
        source: "bank_transaction",
        pending: true,
        countsInCashFlow: true,
      },
    ]),
    { income: 1200, out: 325.5, net: 874.5, transactions: 3 },
  );
});

test("a locally filtered needs-review bank row stays visible as an entry without changing cash totals", () => {
  const needsReviewRow = {
    amount: -86.42,
    source: "bank_transaction",
    countsInCashFlow: false,
  };

  assert.equal(countsInDisplayedCashFlow(needsReviewRow), false);
  assert.deepEqual(summarizeDisplayedActivity([needsReviewRow]), {
    income: 0,
    out: 0,
    net: 0,
    transactions: 1,
  });
});

test("non-date desktop sorting stays flat instead of creating duplicate date groups", () => {
  const rows = [
    { id: "a", date: "2026-08-24" },
    { id: "b", date: "2026-08-23" },
    { id: "c", date: "2026-08-24" },
  ];

  assert.deepEqual(groupDisplayedActivityByDate(rows, false), [
    { date: "", rows },
  ]);
  assert.deepEqual(
    groupDisplayedActivityByDate([rows[0], rows[2], rows[1]], true).map(
      (group) => ({
        date: group.date,
        ids: group.rows.map((row) => row.id),
      }),
    ),
    [
      { date: "2026-08-24", ids: ["a", "c"] },
      { date: "2026-08-23", ids: ["b"] },
    ],
  );
});

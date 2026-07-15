import assert from "node:assert/strict";
import test from "node:test";

import { isActiveTransaction, isConfirmedBillMatch, isMatchedPaymentLowerThanPlanned, rankBillMatches } from "./billMatching";

test("ranks an exact nearby utility payment above unrelated bills", () => {
  const ranked = rankBillMatches(
    { date: "2026-07-12", amount: -142.18, description: "CITY ELECTRIC ONLINE PMT", category: "Utilities" },
    [
      { billId: "electric", name: "City Electric", category: "Utilities", plannedAmount: 142.18, occurrenceDates: ["2026-07-14"] },
      { billId: "rent", name: "Rent", category: "Housing", plannedAmount: 1400, occurrenceDates: ["2026-07-01"] },
    ],
  );

  assert.equal(ranked[0].billId, "electric");
  assert.equal(ranked[0].confidence, "strong");
  assert.ok(ranked[0].reasons.includes("exact amount"));
});

test("uses each occurrence amount for weekly bills", () => {
  const ranked = rankBillMatches(
    { date: "2026-07-15", amount: -50, description: "Weekly childcare" },
    [{ billId: "care", name: "Childcare", category: "Other", plannedAmount: 50, occurrenceDates: ["2026-07-01", "2026-07-08", "2026-07-15"] }],
  );

  assert.equal(ranked[0].amountDifference, 0);
  assert.equal(ranked[0].daysApart, 0);
  assert.equal(ranked[0].confidence, "strong");
});

test("removed or pending Plaid rows are not active", () => {
  assert.equal(isActiveTransaction({ removed_at: null }), true);
  assert.equal(isActiveTransaction({ removed_at: null, pending: false }), true);
  assert.equal(isActiveTransaction({ removed_at: null, pending: true }), false);
  assert.equal(isActiveTransaction({ removed_at: "2026-07-14T12:00:00Z" }), false);
});

test("only confirmed matches replace a planned bill event", () => {
  assert.equal(isConfirmedBillMatch({ match_reason: "confirmed_bill_match" }), true);
  assert.equal(isConfirmedBillMatch({ match_reason: "rule suggestion" }), false);
});

test("prompts for leftover money only when a confirmed payment is lower", () => {
  assert.equal(isMatchedPaymentLowerThanPlanned(-350, 370), true);
  assert.equal(isMatchedPaymentLowerThanPlanned(-370, 370), false);
  assert.equal(isMatchedPaymentLowerThanPlanned(-400, 370), false);
  assert.equal(isMatchedPaymentLowerThanPlanned(-369.999, 370), false);
});

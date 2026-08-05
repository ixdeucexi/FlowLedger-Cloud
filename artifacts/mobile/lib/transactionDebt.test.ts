import assert from "node:assert/strict";
import test from "node:test";

import { transactionDebt, transactionDebtId } from "./transactionDebt";

const bills = [
  { id: "utility", name: "Electric", is_debt: false },
  { id: "card-one", name: "Capital One", is_debt: true },
  { id: "car", name: "Car Loan", is_debt: true },
];

test("resolves the debt selected on a transaction", () => {
  assert.equal(
    transactionDebt({ linked_bill_id: "card-one" }, bills)?.name,
    "Capital One",
  );
});

test("falls back to the applied debt for an older saved transaction", () => {
  assert.equal(
    transactionDebtId({ debt_applied_bill_id: "car" }, bills),
    "car",
  );
});

test("does not label a linked non-debt bill as debt", () => {
  assert.equal(
    transactionDebt({ linked_bill_id: "utility" }, bills),
    undefined,
  );
});

test("prefers a newly selected debt over the prior applied debt", () => {
  assert.equal(
    transactionDebtId(
      {
        linked_bill_id: "car",
        debt_applied_bill_id: "card-one",
      },
      bills,
    ),
    "car",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { orderActiveDebtsForStrategy, sortDebtsLeastToGreatest, sortDebtsWithPaidLast } from "./debtOrder";

test("sorts debts from least to greatest balance", () => {
  const result = sortDebtsLeastToGreatest([
    { name: "Large", balance: 5000 },
    { name: "Small", balance: 125 },
    { name: "Middle", balance: 900 },
  ]);

  assert.deepEqual(result.map(debt => debt.name), ["Small", "Middle", "Large"]);
});

test("uses debt name as the tie-breaker without mutating the input", () => {
  const input = [
    { name: "Zulu", balance: 500 },
    { name: "Alpha", balance: 500 },
  ];
  const result = sortDebtsLeastToGreatest(input);

  assert.deepEqual(result.map(debt => debt.name), ["Alpha", "Zulu"]);
  assert.deepEqual(input.map(debt => debt.name), ["Zulu", "Alpha"]);
});

test("renumbers only active included debts when balances move", () => {
  const debts = [
    { id: "paid", name: "Paid", balance: 0, interest_rate: 29, include_in_snowball: true },
    { id: "large", name: "Large", balance: 500, interest_rate: 24, include_in_snowball: true },
    { id: "small", name: "Small", balance: 80, interest_rate: 0, include_in_snowball: true },
    { id: "off", name: "Excluded", balance: 20, interest_rate: 30, include_in_snowball: false },
  ];

  assert.deepEqual(orderActiveDebtsForStrategy(debts, "snowball").map(debt => debt.id), ["small", "large"]);
  assert.deepEqual(orderActiveDebtsForStrategy(debts, "avalanche").map(debt => debt.id), ["large", "small"]);
});

test("keeps paid debts below active debts in the balance view", () => {
  const result = sortDebtsWithPaidLast([
    { name: "Paid", balance: 0 },
    { name: "Second", balance: 500 },
    { name: "First", balance: 80 },
  ]);

  assert.deepEqual(result.map(debt => debt.name), ["First", "Second", "Paid"]);
});

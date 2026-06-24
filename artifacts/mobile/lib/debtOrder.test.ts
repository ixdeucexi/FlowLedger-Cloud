import assert from "node:assert/strict";
import test from "node:test";

import { sortDebtsLeastToGreatest } from "./debtOrder";

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

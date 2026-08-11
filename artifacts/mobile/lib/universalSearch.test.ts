import assert from "node:assert/strict";
import test from "node:test";

import { APP_COMMANDS, buildUniversalSearchIndex, mergeSearchResults, searchUniversalIndex } from "./universalSearch";

const index = buildUniversalSearchIndex({
  bills: [
    { id: "bill", name: "Electric Bill", category: "Utilities", is_debt: false, amount: 120, balance: 0 },
    { id: "debt", name: "Visa Card", category: "Credit Card", is_debt: true, amount: 50, balance: 900 },
  ],
  goals: [{ id: "goal", name: "Emergency Fund", current_amount: 800, target_amount: 1_000 }],
  transactions: [{ id: "tx", date: "2026-08-01", note: "Weekend groceries", category: "Food", merchant_name: "Market", amount: -45 }],
  categories: ["Food", "Utilities", "Food"],
  settings: [{ id: "security", label: "Account & security", description: "App lock", icon: "shield" }],
});

test("universal search groups real entities and routes debts correctly", () => {
  assert.equal(searchUniversalIndex(index, "visa")[0].kind, "Debt");
  assert.deepEqual(searchUniversalIndex(index, "visa")[0].params, { view: "debt", debtId: "debt" });
  assert.equal(searchUniversalIndex(index, "weekend groceries")[0].id, "tx");
  assert.equal(index.filter(result => result.kind === "Category" && result.title === "Food").length, 1);
});

test("universal search favors exact title matches and deduplicates remote rows", () => {
  const local = searchUniversalIndex(index, "market");
  const merged = mergeSearchResults(local, [{ ...local[0] }, { ...local[0], id: "remote" }]);
  assert.equal(merged.filter(result => result.id === "tx").length, 1);
  assert.equal(merged.some(result => result.id === "remote"), true);
});

test("command palette exposes only supported application actions", () => {
  assert.equal(APP_COMMANDS.some(command => command.id === "add-transaction"), true);
  assert.equal(APP_COMMANDS.some(command => command.id === "open-snowball" && command.route === "/snowball-plan"), true);
  assert.equal(APP_COMMANDS.every(command => command.route.startsWith("/")), true);
});

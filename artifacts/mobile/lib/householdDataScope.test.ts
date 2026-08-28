import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ownsLegacyPersonalRows } from "./householdDataScope";

test("only a personal household owner can load legacy owner rows", () => {
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "owner" }), true);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "manager" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "editor" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "viewer" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "shared", isPersonal: false, role: "owner" }), false);
  assert.equal(ownsLegacyPersonalRows(null), false);
});

test("membership loading and every resume surface share the owner-only privacy rule", () => {
  const households = readFileSync("lib/households.ts", "utf8");
  const rootLayout = readFileSync("app/_layout.tsx", "utf8");
  const budgetContext = readFileSync("context/BudgetContext.tsx", "utf8");
  const activity = readFileSync("app/(tabs)/transactions.tsx", "utf8");

  assert.match(households, /const isPersonal = ownsLegacyPersonalRows\(/);
  assert.match(rootLayout, /ownsLegacyPersonalRows\(scope\)/);
  assert.match(budgetContext, /if \(ownsLegacyPersonalRows\(priorScope\)\) return/);
  assert.match(budgetContext, /if \(ownsLegacyPersonalRows\(scope\)\) \{/);
  assert.match(
    budgetContext,
    /if \(ownsLegacyPersonalRows\(scope\)\) \{[\s\S]+return query\.eq\("household_id", scope\.householdId\)/,
  );
  assert.match(
    budgetContext,
    /if \(ownsLegacyPersonalRows\(priorScope\)\) return;[\s\S]+verifyCurrentHouseholdMembership\(userId, priorScope\.householdId\)/,
  );
  // Activity consumes BudgetContext's complete, already-scoped ledger and must
  // not issue a second household query with its own scoping implementation.
  assert.doesNotMatch(activity, /supabase\.from\("transactions"\)/);
  assert.match(activity, /selectFlowLedgerTransactions\(\s*transactions,/);
  assert.doesNotMatch(budgetContext, /if \(priorScope\.isPersonal\) return/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  householdResolutionChangesCommittedScope,
  ownsLegacyPersonalRows,
} from "./householdDataScope";

test("only a personal household owner can load legacy owner rows", () => {
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "owner" }), true);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "manager" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "editor" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "home", isPersonal: true, role: "viewer" }), false);
  assert.equal(ownsLegacyPersonalRows({ householdId: "shared", isPersonal: false, role: "owner" }), false);
  assert.equal(ownsLegacyPersonalRows(null), false);
});

test("household discovery compares against the scope committed when it finishes", () => {
  // A cache commits H1 while the membership request is in flight. Resolving
  // that same H1 must not clear the cache or re-enter startup loading.
  assert.equal(
    householdResolutionChangesCommittedScope("household-1", "household-1"),
    false,
  );
  // A genuine selection/access change still fails closed.
  assert.equal(
    householdResolutionChangesCommittedScope("household-1", "household-2"),
    true,
  );
  assert.equal(
    householdResolutionChangesCommittedScope(null, "household-1"),
    true,
  );
  assert.equal(householdResolutionChangesCommittedScope("household-1", null), true);
});

test("cache hydration during deferred discovery does not clear the same scope", async () => {
  let committedHouseholdId: string | null = null;
  let clearCount = 0;
  let resolveDiscovery!: (householdId: string) => void;
  const discovery = new Promise<string>((resolve) => {
    resolveDiscovery = resolve;
  });
  const commitDiscovery = discovery.then((resolvedHouseholdId) => {
    if (householdResolutionChangesCommittedScope(
      committedHouseholdId,
      resolvedHouseholdId,
    )) clearCount += 1;
    committedHouseholdId = resolvedHouseholdId;
  });

  // This is the production race: discovery captured null, then cache H1
  // committed before discovery returned the same H1.
  committedHouseholdId = "household-1";
  resolveDiscovery("household-1");
  await commitDiscovery;
  assert.equal(clearCount, 0);

  const resolvedReplacement = "household-2";
  if (householdResolutionChangesCommittedScope(
    committedHouseholdId,
    resolvedReplacement,
  )) clearCount += 1;
  assert.equal(clearCount, 1);
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
  assert.match(
    budgetContext,
    /const committedHouseholdId = householdScopeRef\.current\?\.householdId \?\? null;[\s\S]+householdResolutionChangesCommittedScope\(\s*committedHouseholdId,\s*nextHouseholdId/,
  );
  assert.doesNotMatch(
    budgetContext,
    /const priorHouseholdId = householdScopeRef\.current\?\.householdId \?\? null;[\s\S]{0,1200}const scopeChanged = priorHouseholdId !== nextHouseholdId/,
  );
  // Activity consumes BudgetContext's complete, already-scoped ledger and must
  // not issue a second household query with its own scoping implementation.
  assert.doesNotMatch(activity, /supabase\.from\("transactions"\)/);
  assert.match(activity, /selectFlowLedgerTransactions\(\s*transactions,/);
  assert.doesNotMatch(budgetContext, /if \(priorScope\.isPersonal\) return/);
});

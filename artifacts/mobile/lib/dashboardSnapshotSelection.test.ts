import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingDashboardFinancialSnapshot,
  type DashboardFinancialSnapshotIdentity,
  type DashboardFinancialSnapshotReady,
} from "./dashboardFinancialSnapshot";
import {
  dashboardSnapshotAfterBuildError,
  selectDashboardFinancialSnapshotForRender,
} from "./dashboardSnapshotSelection";

const scope: DashboardFinancialSnapshotIdentity = {
  userId: "user-one",
  householdId: "household-one",
  budgetId: "budget-one",
  dataRevision: "data-1",
  planInputRevision: "plan-1",
};

function ready(identity: DashboardFinancialSnapshotIdentity): DashboardFinancialSnapshotReady {
  return {
    status: "ready",
    key: pendingDashboardFinancialSnapshot(identity).key,
    identity: { ...identity },
    computedAt: "2026-08-28T12:00:00.000Z",
    // Selection policy never inspects financial payload contents.
    value: {} as DashboardFinancialSnapshotReady["value"],
  };
}

test("same-scope revision refresh preserves the mounted ready object", () => {
  const priorReady = ready(scope);
  const nextRevision = {
    ...scope,
    dataRevision: "data-2",
    planInputRevision: "plan-2",
  };

  assert.equal(
    selectDashboardFinancialSnapshotForRender({
      identity: nextRevision,
      startupCoreReady: true,
      computed: priorReady,
    }),
    priorReady,
  );
});

test("same-scope target failure publishes an exact retry state", () => {
  const revisionOne = ready(scope);
  const revisionTwoIdentity = { ...scope, dataRevision: "data-2" };
  const visibleAfterFailure = dashboardSnapshotAfterBuildError(
    revisionOne,
    revisionTwoIdentity,
    "temporarily offline",
  );

  assert.equal(visibleAfterFailure.status, "error");
  assert.equal(visibleAfterFailure.key, pendingDashboardFinancialSnapshot(revisionTwoIdentity).key);
  assert.deepEqual(visibleAfterFailure.identity, revisionTwoIdentity);
  assert.equal(visibleAfterFailure.value, null);
  const revisionTwo = ready(revisionTwoIdentity);
  assert.equal(
    selectDashboardFinancialSnapshotForRender({
      identity: revisionTwoIdentity,
      startupCoreReady: true,
      computed: revisionTwo,
    }),
    revisionTwo,
  );
});

test("auth, household, and budget transitions never expose the prior snapshot", () => {
  const priorReady = ready(scope);
  const transitions: DashboardFinancialSnapshotIdentity[] = [
    { ...scope, userId: "user-two" },
    { ...scope, householdId: "household-two" },
    { ...scope, budgetId: "budget-two" },
    { ...scope, budgetId: null },
  ];

  transitions.forEach(identity => {
    const selected = selectDashboardFinancialSnapshotForRender({
      identity,
      startupCoreReady: true,
      computed: priorReady,
    });
    assert.equal(selected?.status, "pending");
    assert.equal(selected?.value, null);
    assert.deepEqual(selected?.identity, identity);
  });

  assert.equal(selectDashboardFinancialSnapshotForRender({
    identity: null,
    startupCoreReady: false,
    computed: priorReady,
  }), null);
});

test("an unverified core stays pending even when its revision key matches", () => {
  const selected = selectDashboardFinancialSnapshotForRender({
    identity: scope,
    startupCoreReady: false,
    computed: ready(scope),
  });
  assert.equal(selected?.status, "pending");
  assert.equal(selected?.value, null);
});

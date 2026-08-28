import {
  dashboardFinancialSnapshotKey,
  errorDashboardFinancialSnapshot,
  isDashboardFinancialSnapshotReadyForScope,
  pendingDashboardFinancialSnapshot,
  type DashboardFinancialSnapshotIdentity,
  type DashboardFinancialSnapshotState,
} from "./dashboardFinancialSnapshot";

/**
 * Selects the immutable Dashboard value a consumer may render.
 *
 * Revisions inside one exact financial scope are stale-while-revalidate: a
 * ready tree stays mounted while its replacement is pending. A completed
 * replacement or exact target error swaps atomically. Auth, household, and
 * budget transitions fail closed to a value-less pending state.
 */
export function selectDashboardFinancialSnapshotForRender(input: {
  identity: DashboardFinancialSnapshotIdentity | null;
  startupCoreReady: boolean;
  computed: DashboardFinancialSnapshotState | null;
}): DashboardFinancialSnapshotState | null {
  const { identity, startupCoreReady, computed } = input;
  if (!identity) return null;
  if (!startupCoreReady) return pendingDashboardFinancialSnapshot(identity);
  if (computed?.key === dashboardFinancialSnapshotKey(identity)) return computed;
  if (isDashboardFinancialSnapshotReadyForScope(
    computed,
    identity.userId,
    identity.householdId,
    identity.budgetId,
  )) return computed;
  return pendingDashboardFinancialSnapshot(identity);
}

/** A failed target is always surfaced honestly as its exact-key retry state. */
export function dashboardSnapshotAfterBuildError(
  _current: DashboardFinancialSnapshotState | null,
  identity: DashboardFinancialSnapshotIdentity,
  message: string,
): DashboardFinancialSnapshotState {
  return errorDashboardFinancialSnapshot(identity, message);
}

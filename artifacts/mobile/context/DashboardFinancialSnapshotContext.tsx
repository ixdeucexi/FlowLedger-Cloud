import React, { createContext, useContext } from "react";

import type { DashboardFinancialSnapshotState } from "@/lib/dashboardFinancialSnapshot";

export interface DashboardFinancialSnapshotContextValue {
  dashboardFinancialSnapshot: DashboardFinancialSnapshotState | null;
  dashboardSnapshotTargetKey: string | null;
  dashboardSnapshotDemanded: boolean;
  dashboardSnapshotContentMountedForKey: boolean;
  dashboardSnapshotStartupSettled: boolean;
  acknowledgeDashboardSnapshotContentMounted: (snapshotKey: string) => () => void;
  retryDashboardFinancialSnapshot: () => void;
}

const DashboardFinancialSnapshotContext = createContext<
  DashboardFinancialSnapshotContextValue | undefined
>(undefined);

export function DashboardFinancialSnapshotContextProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: DashboardFinancialSnapshotContextValue;
}) {
  return (
    <DashboardFinancialSnapshotContext.Provider value={value}>
      {children}
    </DashboardFinancialSnapshotContext.Provider>
  );
}

export function useDashboardFinancialSnapshot() {
  const context = useContext(DashboardFinancialSnapshotContext);
  if (!context) {
    throw new Error(
      "useDashboardFinancialSnapshot must be used within BudgetProvider",
    );
  }
  return {
    dashboardFinancialSnapshot: context.dashboardFinancialSnapshot,
    acknowledgeDashboardSnapshotContentMounted:
      context.acknowledgeDashboardSnapshotContentMounted,
    retryDashboardFinancialSnapshot: context.retryDashboardFinancialSnapshot,
  };
}

/** Read-only status for the workspace cover; this does not create demand. */
export function useDashboardFinancialSnapshotStatus() {
  const context = useContext(DashboardFinancialSnapshotContext);
  if (!context) {
    throw new Error(
      "useDashboardFinancialSnapshotStatus must be used within BudgetProvider",
    );
  }
  return {
    dashboardSnapshotDemanded: context.dashboardSnapshotDemanded,
    dashboardSnapshotTargetKey: context.dashboardSnapshotTargetKey,
    dashboardSnapshotContentMountedForKey:
      context.dashboardSnapshotContentMountedForKey,
    dashboardSnapshotStartupSettled: context.dashboardSnapshotStartupSettled,
  };
}

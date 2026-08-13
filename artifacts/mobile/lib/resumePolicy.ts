export const PLAN_RESUME_STALE_MS = 2 * 60 * 1000;

export interface HouseholdRestoreCandidate {
  householdId: string;
  isPersonal: boolean;
}

export function chooseRestoredHousehold<T extends HouseholdRestoreCandidate>({
  households,
  storedHouseholdId,
  remoteHouseholdId,
}: {
  households: T[];
  storedHouseholdId?: string | null;
  remoteHouseholdId?: string | null;
}): T | null {
  if (households.length === 0) return null;
  return households.find(item => item.householdId === storedHouseholdId)
    ?? households.find(item => item.householdId === remoteHouseholdId)
    ?? households.find(item => item.isPersonal)
    ?? households[0];
}

export function shouldRefreshPlanOnResume({
  lastRefreshAt,
  now = Date.now(),
  online = true,
  staleAfterMs = PLAN_RESUME_STALE_MS,
}: {
  lastRefreshAt: number;
  now?: number;
  online?: boolean;
  staleAfterMs?: number;
}) {
  if (!online || now <= 0 || staleAfterMs < 0) return false;
  if (lastRefreshAt <= 0) return true;
  return now - lastRefreshAt >= staleAfterMs;
}

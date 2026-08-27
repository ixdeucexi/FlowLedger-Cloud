export const PLAN_RESUME_STALE_MS = 2 * 60 * 1000;
export const PWA_RESUME_STALE_MS = 5 * 60 * 1000;

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

export async function loadResolvedHouseholdSelection<T extends HouseholdRestoreCandidate>({
  loadHouseholds,
  readStoredHouseholdId,
  readRemoteHouseholdId,
}: {
  loadHouseholds: () => Promise<T[]>;
  readStoredHouseholdId: () => Promise<string | null>;
  readRemoteHouseholdId: () => Promise<string | null>;
}): Promise<{
  households: T[];
  activeHousehold: T | null;
  remoteHouseholdId: string | null;
}> {
  // Resolve every critical discovery read before returning anything a caller
  // could commit. Rejections leave the caller's cached scope/data untouched.
  const households = await loadHouseholds();
  if (households.length === 0) {
    return { households, activeHousehold: null, remoteHouseholdId: null };
  }
  const [storedHouseholdId, remoteHouseholdId] = await Promise.all([
    readStoredHouseholdId(),
    readRemoteHouseholdId(),
  ]);
  return {
    households,
    activeHousehold: chooseRestoredHousehold({
      households,
      storedHouseholdId,
      remoteHouseholdId,
    }),
    remoteHouseholdId,
  };
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

export function shouldReleaseBudgetLoading({
  backgroundRefresh,
  blockingScopeTransition,
  blockingUserTransition,
  loadSucceeded,
}: {
  backgroundRefresh: boolean;
  blockingScopeTransition: boolean;
  blockingUserTransition: boolean;
  loadSucceeded: boolean;
}) {
  if (blockingScopeTransition || blockingUserTransition) return loadSucceeded;
  return !backgroundRefresh;
}

export function scopedRequestIsCurrent({
  requestId,
  currentRequestId,
  householdId,
  currentHouseholdId,
}: {
  requestId: number;
  currentRequestId: number;
  householdId: string;
  currentHouseholdId?: string | null;
}) {
  return requestId === currentRequestId && householdId === currentHouseholdId;
}

export function householdResolutionIsCurrent({
  requestId,
  currentRequestId,
  requestUserId,
  currentUserId,
}: {
  requestId: number;
  currentRequestId: number;
  requestUserId: string;
  currentUserId?: string | null;
}) {
  return requestId === currentRequestId && requestUserId === currentUserId;
}

export const PLAN_RESUME_STALE_MS = 2 * 60 * 1000;

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

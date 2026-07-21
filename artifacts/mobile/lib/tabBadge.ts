export function tabBadgeValue(count: number): number | "99+" | undefined {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (safeCount === 0) return undefined;
  return safeCount > 99 ? "99+" : safeCount;
}

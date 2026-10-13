export interface NativeBadgeApi {
  setBadgeCountAsync?: (badgeCount: number) => Promise<boolean>;
}

export function appNotificationCount(...counts: number[]) {
  return counts.reduce((total, count) => {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    return total + safeCount;
  }, 0);
}

export async function syncNativeAppBadge(count: number, badgeApi: NativeBadgeApi) {
  if (!badgeApi.setBadgeCountAsync) return;
  try {
    await badgeApi.setBadgeCountAsync(appNotificationCount(count));
  } catch {
    // OS badge support and permission are optional and must never block the app.
  }
}

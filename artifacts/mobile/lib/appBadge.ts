import { appNotificationCount } from "./appBadgeCore";

export { appNotificationCount };

type BadgeNavigator = Navigator & {
  clearAppBadge?: () => Promise<void>;
  setAppBadge?: (contents?: number) => Promise<void>;
};

function badgeNavigator() {
  if (typeof navigator === "undefined") return null;
  return navigator as BadgeNavigator;
}

export async function syncAppBadge(count: number) {
  const nav = badgeNavigator();
  if (!nav) return;

  const safeCount = appNotificationCount(count);
  try {
    if (safeCount > 0 && nav.setAppBadge) {
      await nav.setAppBadge(safeCount);
    } else if (safeCount === 0 && nav.clearAppBadge) {
      await nav.clearAppBadge();
    }
  } catch {
    // Launchers and browsers decide whether app-icon badges are available.
  }
}

export async function clearAppBadge() {
  const nav = badgeNavigator();
  if (!nav?.clearAppBadge) return;
  try {
    await nav.clearAppBadge();
  } catch {
    // Badge support is optional and must never block the app.
  }
}

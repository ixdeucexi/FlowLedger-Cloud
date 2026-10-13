import * as Notifications from "expo-notifications";

import { appNotificationCount, syncNativeAppBadge } from "./appBadgeCore";

export { appNotificationCount };

export async function syncAppBadge(count: number) {
  await syncNativeAppBadge(count, Notifications);
}

export async function clearAppBadge() {
  await syncNativeAppBadge(0, Notifications);
}

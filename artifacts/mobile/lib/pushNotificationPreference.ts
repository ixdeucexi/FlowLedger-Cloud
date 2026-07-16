export const LEGACY_PUSH_PREFERENCE_KEY = "flowledger_push_notifications_enabled_v1";

export function pushPreferenceStorageKey(userId: string): string {
  return `flowledger_push_notifications_enabled_v2:${userId}`;
}

export function shouldRestorePushNotifications(
  preferenceEnabled: boolean,
  permission: NotificationPermission,
): boolean {
  return preferenceEnabled && permission === "granted";
}

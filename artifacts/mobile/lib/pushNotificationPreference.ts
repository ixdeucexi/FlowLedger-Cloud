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

export async function parseNotificationJson<T>(
  response: Pick<Response, "headers" | "json">,
  fallback: string,
): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error(fallback);
  try {
    return await response.json() as T;
  } catch {
    throw new Error(fallback);
  }
}

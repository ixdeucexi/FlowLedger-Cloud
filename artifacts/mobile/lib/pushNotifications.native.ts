import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";
import { getInstallationId } from "@/lib/deviceInstallation";
import { SerializedLatestOperation } from "@/lib/latestOperation";
import { notificationDestination } from "@/lib/nativeNotificationRoute";
import { pushPreferenceStorageKey } from "@/lib/pushNotificationPreference";
import { reconcileNativePushStatus } from "@/lib/nativePushStatusPolicy";

export type PushNotificationStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled" | "degraded";
import { emitNotificationPreferencesChanged, normalizeNotificationPreferences, type NotificationPreferenceKey } from "@/lib/notificationPreferences";
export { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferenceKey, type NotificationPreferences } from "@/lib/notificationPreferences";

const registrationGate = new SerializedLatestOperation();

function authorization(accessToken: string) { return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }; }
function environment(): "development" | "preview" | "production" {
  const value = Constants.expoConfig?.extra?.appEnvironment;
  if (value === "production" || value === "preview" || value === "development") return value;
  throw new Error("This build is missing its notification environment.");
}
function projectId(): string {
  const value = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (typeof value !== "string" || !value) throw new Error("Native notifications are missing the EAS project ID.");
  return value;
}
async function apiMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { message?: string };
  return payload.message || fallback;
}
async function preferenceEnabled(userId: string) {
  return await AsyncStorage.getItem(pushPreferenceStorageKey(userId)).catch(() => null) === "true";
}
async function ensureAndroidChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("flowledger-alerts", {
      name: "FlowLedger alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: "#9B5CFF",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationChannelAsync("flowledger-tips", {
      name: "FlowLedger account tips",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}
async function registerDevice(accessToken: string, userId: string, householdId: string, rotatedToken?: string) {
  if (!householdId) throw new Error("Choose a household before enabling notifications.");
  return registrationGate.schedule(async isCurrent => {
    await ensureAndroidChannel();
    const token = rotatedToken || (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    const installationId = await getInstallationId();
    if (!isCurrent()) return;
    const response = await apiFetch("/api/notifications/subscription", {
      method: "POST",
      headers: authorization(accessToken),
      body: JSON.stringify({ kind: "expo", token, userId, householdId, installationId, platform: Platform.OS, environment: environment() }),
    });
    if (!response.ok) throw new Error(await apiMessage(response, "Could not register notifications for this device."));
  });
}

export function suspendPushNotificationRegistration() { registrationGate.invalidate(); }

export async function getPushNotificationStatus(userId: string, accessToken?: string, householdId?: string): Promise<PushNotificationStatus> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unsupported";
  const permission = await Notifications.getPermissionsAsync();
  const preferred = await preferenceEnabled(userId);
  if (!preferred || permission.status !== "granted" || !accessToken || !householdId) {
    return reconcileNativePushStatus({ supported: true, permission: permission.status, preferenceEnabled: preferred, serverRegistered: false });
  }
  const query = new URLSearchParams({ kind: "expo", installationId: await getInstallationId(), householdId, platform: Platform.OS, environment: environment() });
  const response = await apiFetch(`/api/notifications/subscription?${query.toString()}`, { headers: authorization(accessToken) });
  const registered = response.ok ? Boolean((await response.json() as { registered?: boolean }).registered) : null;
  return reconcileNativePushStatus({ supported: true, permission: permission.status, preferenceEnabled: preferred, serverRegistered: registered });
}

export async function enablePushNotifications(accessToken: string, userId: string, householdId?: string) {
  await ensureAndroidChannel();
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Allow notifications for FlowLedger in your device settings, then try again.");
  await registerDevice(accessToken, userId, householdId || "");
  await AsyncStorage.setItem(pushPreferenceStorageKey(userId), "true");
}

export async function disablePushNotifications(accessToken: string, userId: string) {
  await registrationGate.invalidateAndWait(async () => {
    const response = await apiFetch("/api/notifications/subscription", {
      method: "DELETE",
      headers: authorization(accessToken),
      body: JSON.stringify({ kind: "expo", installationId: await getInstallationId(), platform: Platform.OS, environment: environment() }),
    });
    if (!response.ok) throw new Error(await apiMessage(response, "Could not disable notifications."));
  });
  await AsyncStorage.setItem(pushPreferenceStorageKey(userId), "false");
}

export async function detachPushNotifications(accessToken: string) {
  let failure: Error | null = null;
  try {
    await registrationGate.invalidateAndWait(async () => {
      const response = await apiFetch("/api/notifications/subscription", {
        method: "DELETE",
        headers: authorization(accessToken),
        body: JSON.stringify({ kind: "expo", installationId: await getInstallationId(), platform: Platform.OS, environment: environment() }),
      });
      if (!response.ok) failure = new Error(await apiMessage(response, "Could not detach notifications during sign out."));
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error("Could not detach notifications during sign out.");
  }
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  if (failure) {
    await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
    throw failure;
  }
}

export async function purgeLocalPushNotifications() {
  registrationGate.invalidate();
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
}

export async function restorePushNotifications(accessToken: string, userId: string, householdId?: string) {
  if (!householdId || !await preferenceEnabled(userId)) return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  await registerDevice(accessToken, userId, householdId);
}

export function subscribeToPushTokenRotation(accessToken: string, userId: string, householdId: string, onError: (error: unknown) => void) {
  const subscription = Notifications.addPushTokenListener(devicePushToken => {
    void Notifications.getExpoPushTokenAsync({ projectId: projectId(), devicePushToken })
      .then(expoToken => registerDevice(accessToken, userId, householdId, expoToken.data))
      .catch(onError);
  });
  return () => {
    registrationGate.invalidate();
    subscription.remove();
  };
}

export async function sendTestPushNotification(accessToken: string, type: NotificationPreferenceKey, householdId?: string) {
  const response = await apiFetch("/api/notifications/test", { method: "POST", headers: authorization(accessToken), body: JSON.stringify({ type, householdId }) });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not send the test notification."));
}
export async function getNotificationPreferences(accessToken: string) {
  const response = await apiFetch("/api/notifications/preferences", { headers: authorization(accessToken), cache: "no-store" });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not load notification choices."));
  const payload = await response.json() as { preferences: unknown; isFeedbackAdmin: boolean };
  return { preferences: normalizeNotificationPreferences(payload.preferences), isFeedbackAdmin: payload.isFeedbackAdmin === true };
}
export async function updateNotificationPreference(accessToken: string, key: NotificationPreferenceKey, enabled: boolean, userId?: string) {
  const response = await apiFetch("/api/notifications/preferences", { method: "PATCH", headers: authorization(accessToken), body: JSON.stringify({ [key]: enabled }) });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not update that notification choice."));
  const payload = await response.json() as { preferences: unknown };
  const preferences = normalizeNotificationPreferences(payload.preferences);
  if (userId) emitNotificationPreferencesChanged({ userId, preferences });
  return preferences;
}

export function configureNativeNotificationPresentation() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
}
export async function getInitialNotificationRoute() {
  const response = await Notifications.getLastNotificationResponseAsync();
  const destination = notificationDestination(response?.notification.request.content.data);
  await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  return destination;
}
export function subscribeToNotificationRoutes(onRoute: (destination: { route: string; householdId: string | null }) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const destination = notificationDestination(response.notification.request.content.data);
    if (destination) onRoute(destination);
  });
  return () => subscription.remove();
}

import { Platform } from "react-native";

import {
  LEGACY_PUSH_PREFERENCE_KEY,
  pushPreferenceStorageKey,
  shouldRestorePushNotifications,
} from "@/lib/pushNotificationPreference";

export type PushNotificationStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled";

export type NotificationPreferenceKey =
  | "pending_transactions"
  | "posted_transactions"
  | "overdue_bills"
  | "feedback_updates"
  | "admin_feedback";

export interface NotificationPreferences {
  pending_transactions: boolean;
  posted_transactions: boolean;
  overdue_bills: boolean;
  feedback_updates: boolean;
  admin_feedback: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pending_transactions: true,
  posted_transactions: true,
  overdue_bills: true,
  feedback_updates: true,
  admin_feedback: true,
};

type ApiError = { message?: string };

function supported() {
  return Platform.OS === "web"
    && typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function apiMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as ApiError;
  return payload.message || fallback;
}

async function registration() {
  const registered = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registered;
}

function savePreference(userId: string, enabled: boolean) {
  try {
    window.localStorage.setItem(pushPreferenceStorageKey(userId), enabled ? "true" : "false");
    window.localStorage.removeItem(LEGACY_PUSH_PREFERENCE_KEY);
  } catch {}
}

function readPreference(userId: string) {
  try {
    const key = pushPreferenceStorageKey(userId);
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored === "true";
    const legacyEnabled = window.localStorage.getItem(LEGACY_PUSH_PREFERENCE_KEY) === "true";
    if (legacyEnabled) window.localStorage.setItem(key, "true");
    window.localStorage.removeItem(LEGACY_PUSH_PREFERENCE_KEY);
    return legacyEnabled;
  } catch {
    return false;
  }
}

async function settledRegistration(userId: string) {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing || !readPreference(userId) || window.Notification.permission !== "granted") return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 3000)),
  ]);
}

function authorization(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

export async function getPushNotificationStatus(userId: string): Promise<PushNotificationStatus> {
  if (!supported()) return "unsupported";
  if (window.Notification.permission === "denied") return "blocked";
  if (!readPreference(userId)) return "disabled";
  const registered = await settledRegistration(userId);
  if (!registered) return "disabled";
  await registered.update().catch(() => undefined);
  const subscription = await registered.pushManager.getSubscription();
  return subscription ? "enabled" : "disabled";
}

export async function enablePushNotifications(accessToken: string, userId: string) {
  if (!supported()) throw new Error("This browser or installed app does not support phone notifications.");
  const configResponse = await fetch("/api/notifications/config");
  if (!configResponse.ok) throw new Error(await apiMessage(configResponse, "Notifications are not configured yet."));
  const { publicKey } = await configResponse.json() as { publicKey: string };

  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") throw new Error("Allow notifications for FlowLedger in your phone settings, then try again.");

  const registered = await registration();
  const existing = await registered.pushManager.getSubscription();
  const subscription = existing || await registered.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  const json = subscription.toJSON();
  const response = await fetch("/api/notifications/subscription", {
    method: "POST",
    headers: authorization(accessToken),
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys }),
  });
  if (!response.ok) {
    if (!existing) await subscription.unsubscribe().catch(() => false);
    throw new Error(await apiMessage(response, "Could not enable notifications."));
  }
  savePreference(userId, true);
}

export async function disablePushNotifications(accessToken: string, userId: string) {
  if (!supported()) return;
  const registered = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registered?.pushManager.getSubscription();
  if (!subscription) {
    savePreference(userId, false);
    return;
  }
  const response = await fetch("/api/notifications/subscription", {
    method: "DELETE",
    headers: authorization(accessToken),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not disable notifications."));
  await subscription.unsubscribe();
  savePreference(userId, false);
}

export async function detachPushNotifications(accessToken: string) {
  if (!supported()) return;
  const registered = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registered?.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch("/api/notifications/subscription", {
    method: "DELETE",
    headers: authorization(accessToken),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => false);
    throw new Error(await apiMessage(response, "Could not pause notifications for sign out."));
  }
}

export async function restorePushNotifications(accessToken: string, userId: string) {
  if (!supported() || !shouldRestorePushNotifications(readPreference(userId), window.Notification.permission)) return;
  await enablePushNotifications(accessToken, userId);
}

export async function sendTestPushNotification(accessToken: string, type: NotificationPreferenceKey) {
  const response = await fetch("/api/notifications/test", {
    method: "POST",
    headers: authorization(accessToken),
    body: JSON.stringify({ type }),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not send the test notification."));
}

export async function getNotificationPreferences(accessToken: string) {
  const response = await fetch("/api/notifications/preferences", {
    headers: authorization(accessToken),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not load notification choices."));
  return response.json() as Promise<{
    preferences: NotificationPreferences;
    isFeedbackAdmin: boolean;
  }>;
}

export async function updateNotificationPreference(
  accessToken: string,
  key: NotificationPreferenceKey,
  enabled: boolean,
) {
  const response = await fetch("/api/notifications/preferences", {
    method: "PATCH",
    headers: authorization(accessToken),
    body: JSON.stringify({ [key]: enabled }),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not update that notification choice."));
  const payload = await response.json() as { preferences: NotificationPreferences };
  return payload.preferences;
}

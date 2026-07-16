import { Platform } from "react-native";

export type PushNotificationStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled";

type ApiError = { message?: string };
const PUSH_PREFERENCE_KEY = "flowledger_push_notifications_enabled_v1";

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

function savePreference(enabled: boolean) {
  try { window.localStorage.setItem(PUSH_PREFERENCE_KEY, enabled ? "true" : "false"); } catch {}
}

function readPreference() {
  try { return window.localStorage.getItem(PUSH_PREFERENCE_KEY) === "true"; } catch { return false; }
}

async function settledRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing || !readPreference() || window.Notification.permission !== "granted") return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 3000)),
  ]);
}

function authorization(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

export async function getPushNotificationStatus(): Promise<PushNotificationStatus> {
  if (!supported()) return "unsupported";
  if (window.Notification.permission === "denied") return "blocked";
  const registered = await settledRegistration();
  if (!registered) return "disabled";
  await registered.update().catch(() => undefined);
  const subscription = await registered.pushManager.getSubscription();
  if (!subscription) savePreference(false);
  return subscription ? "enabled" : "disabled";
}

export async function enablePushNotifications(accessToken: string) {
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
  savePreference(true);
}

export async function disablePushNotifications(accessToken: string) {
  if (!supported()) return;
  const registered = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registered?.pushManager.getSubscription();
  if (!subscription) {
    savePreference(false);
    return;
  }
  const response = await fetch("/api/notifications/subscription", {
    method: "DELETE",
    headers: authorization(accessToken),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not disable notifications."));
  await subscription.unsubscribe();
  savePreference(false);
}

export async function sendTestPushNotification(accessToken: string) {
  const response = await fetch("/api/notifications/test", {
    method: "POST",
    headers: authorization(accessToken),
  });
  if (!response.ok) throw new Error(await apiMessage(response, "Could not send the test notification."));
}

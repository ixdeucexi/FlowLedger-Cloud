export type PushNotificationStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled" | "degraded";
import { type NotificationPreferenceKey, type NotificationPreferences } from "@/lib/notificationPreferences";
export { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferenceKey, type NotificationPreferences } from "@/lib/notificationPreferences";
export interface NativeNotificationDestination { route: string; householdId: string | null }

export async function getPushNotificationStatus(_userId: string, _accessToken?: string, _householdId?: string): Promise<PushNotificationStatus> { return "unsupported"; }
export async function enablePushNotifications(_accessToken: string, _userId: string, _householdId?: string): Promise<void> { throw new Error("Notifications are unavailable in this build."); }
export async function disablePushNotifications(_accessToken: string, _userId: string): Promise<void> {}
export async function detachPushNotifications(_accessToken: string): Promise<void> {}
export function suspendPushNotificationRegistration(): void {}
export async function purgeLocalPushNotifications(): Promise<void> {}
export async function restorePushNotifications(_accessToken: string, _userId: string, _householdId?: string): Promise<void> {}
export function subscribeToPushTokenRotation(_accessToken: string, _userId: string, _householdId: string, _onError: (error: unknown) => void) { return () => undefined; }
export async function sendTestPushNotification(_accessToken: string, _type: NotificationPreferenceKey, _householdId?: string): Promise<void> { throw new Error("Notifications are unavailable in this build."); }
export async function getNotificationPreferences(_accessToken: string): Promise<{ preferences: NotificationPreferences; isFeedbackAdmin: boolean }> { throw new Error("Notifications are unavailable in this build."); }
export async function updateNotificationPreference(_accessToken: string, _key: NotificationPreferenceKey, _enabled: boolean, _userId?: string): Promise<NotificationPreferences> { throw new Error("Notifications are unavailable in this build."); }
export function configureNativeNotificationPresentation(): void {}
export async function getInitialNotificationRoute(): Promise<NativeNotificationDestination | null> { return null; }
export function subscribeToNotificationRoutes(_onRoute: (destination: NativeNotificationDestination) => void): () => void { return () => undefined; }

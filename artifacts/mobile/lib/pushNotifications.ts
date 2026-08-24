export type PushNotificationStatus = "checking" | "unsupported" | "blocked" | "disabled" | "enabled" | "degraded";
export type NotificationPreferenceKey = "pending_transactions" | "posted_transactions" | "overdue_bills" | "feedback_updates" | "admin_feedback";
export interface NotificationPreferences {
  pending_transactions: boolean;
  posted_transactions: boolean;
  overdue_bills: boolean;
  feedback_updates: boolean;
  admin_feedback: boolean;
}
export interface NativeNotificationDestination { route: string; householdId: string | null }
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pending_transactions: true,
  posted_transactions: true,
  overdue_bills: true,
  feedback_updates: true,
  admin_feedback: true,
};

export async function getPushNotificationStatus(_userId: string, _accessToken?: string, _householdId?: string): Promise<PushNotificationStatus> { return "unsupported"; }
export async function enablePushNotifications(_accessToken: string, _userId: string, _householdId?: string): Promise<void> { throw new Error("Notifications are unavailable in this build."); }
export async function disablePushNotifications(_accessToken: string, _userId: string): Promise<void> {}
export async function detachPushNotifications(_accessToken: string): Promise<void> {}
export function suspendPushNotificationRegistration(): void {}
export async function purgeLocalPushNotifications(): Promise<void> {}
export async function restorePushNotifications(_accessToken: string, _userId: string, _householdId?: string): Promise<void> {}
export function subscribeToPushTokenRotation(_accessToken: string, _userId: string, _householdId: string, _onError: (error: unknown) => void) { return () => undefined; }
export async function sendTestPushNotification(_accessToken: string, _type: NotificationPreferenceKey, _householdId?: string): Promise<void> { throw new Error("Notifications are unavailable in this build."); }
export async function getNotificationPreferences(_accessToken: string): Promise<{ preferences: NotificationPreferences; isFeedbackAdmin: boolean }> { return { preferences: DEFAULT_NOTIFICATION_PREFERENCES, isFeedbackAdmin: false }; }
export async function updateNotificationPreference(_accessToken: string, _key: NotificationPreferenceKey, _enabled: boolean): Promise<NotificationPreferences> { return DEFAULT_NOTIFICATION_PREFERENCES; }
export function configureNativeNotificationPresentation(): void {}
export async function getInitialNotificationRoute(): Promise<NativeNotificationDestination | null> { return null; }
export function subscribeToNotificationRoutes(_onRoute: (destination: NativeNotificationDestination) => void): () => void { return () => undefined; }

import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTodayWithFloStoresForUser, type TodayWithFloSaved } from "./todayWithFloPreferences";
import { clearFloLauncherPreferenceStoresForUser } from "./floLauncherVisibility";
import type { DashboardLayoutPreference } from "./dashboardCustomization";
import type { NotificationCenterState } from "./notificationCenter";

const PREFERENCE_PREFIX = "flowledger_interface_v1";

export type CalendarPresentationState = {
  month: number;
  year: number;
  selectedDate?: string;
};

export type ActivityPresentationState = {
  range?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  account?: string;
  category?: string;
  type?: string;
  sort?: "asc" | "desc";
};

export type InterfacePreferences = {
  todayWithFlo?: TodayWithFloSaved;
  floLauncherEnabled?: boolean;
  lastRoute?: string;
  sidebarCollapsed?: boolean;
  settingsSection?: string;
  calendar?: CalendarPresentationState;
  activity?: ActivityPresentationState;
  dashboard?: DashboardLayoutPreference;
  notifications?: NotificationCenterState;
};

function cleanScopePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

export function interfacePreferenceKey(userId: string, householdId: string) {
  return `${PREFERENCE_PREFIX}:${cleanScopePart(userId)}:${cleanScopePart(householdId)}`;
}

export async function readInterfacePreferences(
  userId: string,
  householdId: string,
  throwOnError = false,
): Promise<InterfacePreferences> {
  try {
    const raw = await AsyncStorage.getItem(interfacePreferenceKey(userId, householdId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (throwOnError) throw new Error("Invalid interface preferences");
      return {};
    }
    return parsed as InterfacePreferences;
  } catch (error) {
    if (throwOnError) throw error;
    return {};
  }
}

const writeQueues = new Map<string, Promise<void>>();

export async function updateInterfacePreferences(
  userId: string,
  householdId: string,
  update: Partial<InterfacePreferences> | ((current: InterfacePreferences) => InterfacePreferences),
  strictRead = false,
) {
  const key = interfacePreferenceKey(userId, householdId);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const current = await readInterfacePreferences(userId, householdId, strictRead);
    const merged = typeof update === "function" ? update(current) : { ...current, ...update };
    await AsyncStorage.setItem(key, JSON.stringify(merged));
  });
  writeQueues.set(key, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
}

export async function clearInterfacePreferencesForUser(userId: string) {
  clearTodayWithFloStoresForUser(userId);
  clearFloLauncherPreferenceStoresForUser(userId);
  try {
    const prefix = `${PREFERENCE_PREFIX}:${cleanScopePart(userId)}:`;
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch {
    // Signing out must continue even when device storage is unavailable.
  }
}

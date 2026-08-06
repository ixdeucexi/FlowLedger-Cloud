import AsyncStorage from "@react-native-async-storage/async-storage";
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
): Promise<InterfacePreferences> {
  try {
    const raw = await AsyncStorage.getItem(interfacePreferenceKey(userId, householdId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as InterfacePreferences : {};
  } catch {
    return {};
  }
}

const writeQueues = new Map<string, Promise<void>>();

export async function updateInterfacePreferences(
  userId: string,
  householdId: string,
  update: Partial<InterfacePreferences> | ((current: InterfacePreferences) => InterfacePreferences),
) {
  const key = interfacePreferenceKey(userId, householdId);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const current = await readInterfacePreferences(userId, householdId);
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
  try {
    const prefix = `${PREFERENCE_PREFIX}:${cleanScopePart(userId)}:`;
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch {
    // Signing out must continue even when device storage is unavailable.
  }
}

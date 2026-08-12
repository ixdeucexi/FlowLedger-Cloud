import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "flowledger_flo_preferences_v1";

export type FloPreferences = {
  historyEnabled: boolean;
  rememberPreferences: boolean;
  preferenceNote: string;
};

export const DEFAULT_FLO_PREFERENCES: FloPreferences = {
  historyEnabled: true,
  rememberPreferences: false,
  preferenceNote: "",
};

function clean(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

export function floPreferenceKey(userId: string, householdId: string) {
  return `${KEY_PREFIX}:${clean(userId)}:${clean(householdId)}`;
}

export async function readFloPreferences(userId: string, householdId: string): Promise<FloPreferences> {
  try {
    const raw = await AsyncStorage.getItem(floPreferenceKey(userId, householdId));
    if (!raw) return DEFAULT_FLO_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<FloPreferences>;
    return {
      historyEnabled: parsed.historyEnabled !== false,
      rememberPreferences: parsed.rememberPreferences === true,
      preferenceNote: typeof parsed.preferenceNote === "string" ? parsed.preferenceNote.trim().slice(0, 240) : "",
    };
  } catch {
    return DEFAULT_FLO_PREFERENCES;
  }
}

export async function saveFloPreferences(userId: string, householdId: string, preferences: FloPreferences) {
  await AsyncStorage.setItem(floPreferenceKey(userId, householdId), JSON.stringify(preferences));
}

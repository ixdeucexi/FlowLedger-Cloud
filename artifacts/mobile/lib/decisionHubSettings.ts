import { Platform } from "react-native";

export interface DecisionHubSettings {
  categoryRolloverEnabled: boolean;
}

export const DEFAULT_DECISION_HUB_SETTINGS: DecisionHubSettings = {
  categoryRolloverEnabled: false,
};

export const DECISION_HUB_SETTINGS_KEY = "flowledger-decision-hub-settings";
export const DECISION_HUB_SETTINGS_EVENT = "flowledger-decision-hub-settings-updated";

export function readDecisionHubSettings(): DecisionHubSettings {
  if (Platform.OS !== "web") return DEFAULT_DECISION_HUB_SETTINGS;
  try {
    const raw = globalThis.localStorage?.getItem(DECISION_HUB_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<DecisionHubSettings> : {};
    return {
      categoryRolloverEnabled: Boolean(parsed.categoryRolloverEnabled),
    };
  } catch {
    return DEFAULT_DECISION_HUB_SETTINGS;
  }
}

export function writeDecisionHubSettings(settings: DecisionHubSettings) {
  if (Platform.OS !== "web") return;
  globalThis.localStorage?.setItem(DECISION_HUB_SETTINGS_KEY, JSON.stringify(settings));
  globalThis.dispatchEvent?.(new Event(DECISION_HUB_SETTINGS_EVENT));
}

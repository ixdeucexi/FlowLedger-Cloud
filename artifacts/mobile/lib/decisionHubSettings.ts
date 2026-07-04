import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import {
  defaultAlgorithmToggles,
  normalizeAlgorithmToggles,
  type AlgorithmId,
} from "@/lib/algorithmCatalog";

export interface DecisionHubSettings {
  algorithmSuiteEnabled: boolean;
  algorithmToggles: Record<AlgorithmId, boolean>;
}

export const DEFAULT_DECISION_HUB_SETTINGS: DecisionHubSettings = {
  algorithmSuiteEnabled: true,
  algorithmToggles: defaultAlgorithmToggles(),
};

export const DECISION_HUB_SETTINGS_KEY = "flowledger-decision-hub-settings";
export const DECISION_HUB_SETTINGS_EVENT = "flowledger-decision-hub-settings-updated";

export function readDecisionHubSettings(): DecisionHubSettings {
  if (Platform.OS !== "web") return DEFAULT_DECISION_HUB_SETTINGS;
  try {
    const raw = globalThis.localStorage?.getItem(DECISION_HUB_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<DecisionHubSettings> : {};
    return {
      algorithmSuiteEnabled: parsed.algorithmSuiteEnabled !== false,
      algorithmToggles: normalizeAlgorithmToggles(parsed.algorithmToggles),
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

export async function loadDecisionHubSettings(userId?: string | null): Promise<DecisionHubSettings> {
  const cached = readDecisionHubSettings();
  if (!userId) return cached;
  const { data, error } = await supabase
    .from("user_preferences")
    .select("decision_hub_settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return cached;
  const remote = normalizeDecisionHubSettings(data?.decision_hub_settings);
  writeDecisionHubSettings(remote);
  return remote;
}

export async function saveDecisionHubSettings(userId: string | undefined | null, settings: DecisionHubSettings): Promise<void> {
  writeDecisionHubSettings(settings);
  if (!userId) return;
  const { error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      decision_hub_settings: settings,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Save Decision Center settings: ${error.message}`);
}

function normalizeDecisionHubSettings(value: unknown): DecisionHubSettings {
  const parsed = value && typeof value === "object" ? value as Partial<DecisionHubSettings> : {};
  return {
    algorithmSuiteEnabled: parsed.algorithmSuiteEnabled !== false,
    algorithmToggles: normalizeAlgorithmToggles(parsed.algorithmToggles),
  };
}

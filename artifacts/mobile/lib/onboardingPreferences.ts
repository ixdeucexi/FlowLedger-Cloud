import { Platform } from "react-native";

import {
  DEFAULT_ONBOARDING_PREFERENCES,
  normalizeOnboardingPreferences,
  type OnboardingPreferences,
} from "@/lib/onboarding";
import { supabase } from "@/lib/supabase";

const ONBOARDING_PREFERENCES_KEY = "flowledger-onboarding-preferences";

export function readOnboardingPreferences(): OnboardingPreferences {
  if (Platform.OS !== "web" || typeof globalThis.localStorage === "undefined") {
    return DEFAULT_ONBOARDING_PREFERENCES;
  }
  try {
    const raw = globalThis.localStorage.getItem(ONBOARDING_PREFERENCES_KEY);
    return normalizeOnboardingPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return DEFAULT_ONBOARDING_PREFERENCES;
  }
}

export function writeOnboardingPreferences(preferences: OnboardingPreferences) {
  if (Platform.OS !== "web" || typeof globalThis.localStorage === "undefined") return;
  try {
    globalThis.localStorage.setItem(ONBOARDING_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {}
}

export async function loadOnboardingPreferences(userId?: string | null): Promise<OnboardingPreferences> {
  const cached = readOnboardingPreferences();
  if (!userId) return cached;
  const { data, error } = await supabase
    .from("user_preferences")
    .select("onboarding_preferences")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return cached;
  const remote = normalizeOnboardingPreferences(data?.onboarding_preferences);
  const next = remote.startingPoint || remote.help.length || remote.goals.length || remote.savingsGoal ? remote : cached;
  writeOnboardingPreferences(next);
  return next;
}

export async function saveOnboardingPreferences(userId: string | undefined | null, preferences: OnboardingPreferences): Promise<void> {
  const next = normalizeOnboardingPreferences({
    ...preferences,
    updatedAt: new Date().toISOString(),
  });
  writeOnboardingPreferences(next);
  if (!userId) return;
  const { error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      onboarding_preferences: next,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Save setup preferences: ${error.message}`);
}

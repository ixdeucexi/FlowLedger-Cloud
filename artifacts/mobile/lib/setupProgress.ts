import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type SetupStepKey =
  | "welcome"
  | "intro"
  | "household"
  | "starting_point"
  | "help"
  | "goals_intro"
  | "goals"
  | "savings_goal"
  | "plan"
  | "account"
  | "money"
  | "income"
  | "bills"
  | "debts"
  | "goal_setup"
  | "safety"
  | "reconcile"
  | "finish";

const SETUP_PROGRESS_KEY = "flowledger_setup_step_key";

export function readStoredSetupStep(): SetupStepKey | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SETUP_PROGRESS_KEY);
    return value as SetupStepKey | null;
  } catch {
    return null;
  }
}

export async function readStoredSetupStepAsync(): Promise<SetupStepKey | null> {
  if (Platform.OS === "web") return readStoredSetupStep();
  try {
    return await AsyncStorage.getItem(SETUP_PROGRESS_KEY) as SetupStepKey | null;
  } catch {
    return null;
  }
}

export function writeStoredSetupStep(step: SetupStepKey | null) {
  if (Platform.OS !== "web") {
    void (step ? AsyncStorage.setItem(SETUP_PROGRESS_KEY, step) : AsyncStorage.removeItem(SETUP_PROGRESS_KEY));
    return;
  }
  if (typeof window === "undefined") return;
  try {
    if (step) window.localStorage.setItem(SETUP_PROGRESS_KEY, step);
    else window.localStorage.removeItem(SETUP_PROGRESS_KEY);
  } catch {}
}

export function clearStoredSetupStep() {
  writeStoredSetupStep(null);
}

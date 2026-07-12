import { Platform } from "react-native";

export type SetupStepKey =
  | "welcome"
  | "intro"
  | "household"
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

export function writeStoredSetupStep(step: SetupStepKey | null) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (step) window.localStorage.setItem(SETUP_PROGRESS_KEY, step);
    else window.localStorage.removeItem(SETUP_PROGRESS_KEY);
  } catch {}
}

export function clearStoredSetupStep() {
  writeStoredSetupStep(null);
}

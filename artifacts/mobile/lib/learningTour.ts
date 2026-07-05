import { Platform } from "react-native";

export { LEARNING_TOUR_STEPS, type LearningTourRoute, type LearningTourStep } from "./learningTourCatalog";
import { LEARNING_TOUR_STEPS } from "./learningTourCatalog";

export const LEARNING_TOUR_EVENT = "flowledger-learning-tour-start";
const LEARNING_TOUR_ACTIVE_KEY = "flowledger_learning_tour_active";
const LEARNING_TOUR_STEP_KEY = "flowledger_learning_tour_step";

export function readLearningTourState() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return { active: false, stepIndex: 0 };
  }
  try {
    const active = window.localStorage.getItem(LEARNING_TOUR_ACTIVE_KEY) === "true";
    const stored = Number(window.localStorage.getItem(LEARNING_TOUR_STEP_KEY) ?? 0);
    const stepIndex = Number.isFinite(stored)
      ? Math.max(0, Math.min(LEARNING_TOUR_STEPS.length - 1, stored))
      : 0;
    return { active, stepIndex };
  } catch {
    return { active: false, stepIndex: 0 };
  }
}

export function writeLearningTourState(active: boolean, stepIndex = 0) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (!active) {
      window.localStorage.removeItem(LEARNING_TOUR_ACTIVE_KEY);
      window.localStorage.removeItem(LEARNING_TOUR_STEP_KEY);
      return;
    }
    window.localStorage.setItem(LEARNING_TOUR_ACTIVE_KEY, "true");
    window.localStorage.setItem(
      LEARNING_TOUR_STEP_KEY,
      String(Math.max(0, Math.min(LEARNING_TOUR_STEPS.length - 1, stepIndex))),
    );
  } catch {}
}

export function startLearningTour() {
  writeLearningTourState(true, 0);
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEARNING_TOUR_EVENT));
  }
}

export function clearLearningTour() {
  writeLearningTourState(false, 0);
}

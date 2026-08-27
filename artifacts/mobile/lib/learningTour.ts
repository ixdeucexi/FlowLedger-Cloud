import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export {
  LEARNING_TOUR_STEPS,
  type LearningTourRoute,
  type LearningTourStep,
} from "./learningTourCatalog";
import { LEARNING_TOUR_STEPS } from "./learningTourCatalog";

const LEARNING_TOUR_ACTIVE_KEY = "flowledger_learning_tour_active";
const LEARNING_TOUR_STEP_KEY = "flowledger_learning_tour_step";

export interface LearningTourState {
  active: boolean;
  stepIndex: number;
}

type LearningTourListener = (state: LearningTourState) => void;

let nativeState: LearningTourState = { active: false, stepIndex: 0 };
let nativeStateExplicitlySet = false;
const listeners = new Set<LearningTourListener>();

function boundedStepIndex(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(LEARNING_TOUR_STEPS.length - 1, parsed))
    : 0;
}

function notifyLearningTour(state: LearningTourState) {
  listeners.forEach((listener) => listener(state));
}

export function readLearningTourState(): LearningTourState {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return nativeState;
  }
  try {
    return {
      active:
        window.localStorage.getItem(LEARNING_TOUR_ACTIVE_KEY) === "true",
      stepIndex: boundedStepIndex(
        window.localStorage.getItem(LEARNING_TOUR_STEP_KEY),
      ),
    };
  } catch {
    return { active: false, stepIndex: 0 };
  }
}

export async function hydrateLearningTourState(): Promise<LearningTourState> {
  if (Platform.OS === "web") return readLearningTourState();
  if (nativeStateExplicitlySet) return nativeState;
  try {
    const values = new Map(
      await AsyncStorage.multiGet([
        LEARNING_TOUR_ACTIVE_KEY,
        LEARNING_TOUR_STEP_KEY,
      ]),
    );
    nativeState = {
      active: values.get(LEARNING_TOUR_ACTIVE_KEY) === "true",
      stepIndex: boundedStepIndex(values.get(LEARNING_TOUR_STEP_KEY)),
    };
  } catch {
    nativeState = { active: false, stepIndex: 0 };
  }
  return nativeState;
}

export function writeLearningTourState(active: boolean, stepIndex = 0) {
  const next = { active, stepIndex: boundedStepIndex(stepIndex) };
  nativeState = next;
  nativeStateExplicitlySet = true;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      if (!active) {
        window.localStorage.removeItem(LEARNING_TOUR_ACTIVE_KEY);
        window.localStorage.removeItem(LEARNING_TOUR_STEP_KEY);
        return;
      }
      window.localStorage.setItem(LEARNING_TOUR_ACTIVE_KEY, "true");
      window.localStorage.setItem(
        LEARNING_TOUR_STEP_KEY,
        String(next.stepIndex),
      );
    } catch {}
    return;
  }

  if (active) {
    void AsyncStorage.multiSet([
      [LEARNING_TOUR_ACTIVE_KEY, "true"],
      [LEARNING_TOUR_STEP_KEY, String(next.stepIndex)],
    ]).catch(() => undefined);
  } else {
    void AsyncStorage.multiRemove([
      LEARNING_TOUR_ACTIVE_KEY,
      LEARNING_TOUR_STEP_KEY,
    ]).catch(() => undefined);
  }
}

export function subscribeToLearningTour(
  listener: LearningTourListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startLearningTour() {
  const next = { active: true, stepIndex: 0 };
  writeLearningTourState(next.active, next.stepIndex);
  notifyLearningTour(next);
}

export function clearLearningTour() {
  void clearLearningTourForAccountChange();
}

export async function clearLearningTourForAccountChange(): Promise<void> {
  const next = { active: false, stepIndex: 0 };
  nativeState = next;
  nativeStateExplicitlySet = true;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LEARNING_TOUR_ACTIVE_KEY);
      window.localStorage.removeItem(LEARNING_TOUR_STEP_KEY);
    } catch {}
  } else {
    await AsyncStorage.multiRemove([
      LEARNING_TOUR_ACTIVE_KEY,
      LEARNING_TOUR_STEP_KEY,
    ]).catch(() => undefined);
  }
  notifyLearningTour(next);
}

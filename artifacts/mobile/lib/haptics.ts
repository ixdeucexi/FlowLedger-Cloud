import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ExpoHaptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";

export const HAPTICS_STORAGE_KEY = "@flowledger_haptics_enabled_v1";

export const ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = ExpoHaptics.NotificationFeedbackType;

let enabledCache: boolean | null = null;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<(enabled: boolean) => void>();

function publish(enabled: boolean) {
  enabledCache = enabled;
  listeners.forEach((listener) => listener(enabled));
}

export function parseStoredHapticsPreference(value: string | null) {
  return value !== "false";
}

export function loadHapticsEnabled() {
  if (enabledCache !== null) return Promise.resolve(enabledCache);
  if (loadPromise) return loadPromise;

  loadPromise = AsyncStorage.getItem(HAPTICS_STORAGE_KEY)
    .then((stored) => {
      const enabled = parseStoredHapticsPreference(stored);
      publish(enabled);
      return enabled;
    })
    .catch(() => {
      publish(true);
      return true;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export async function setHapticsEnabled(enabled: boolean) {
  publish(enabled);
  await AsyncStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? "true" : "false").catch(() => undefined);
  if (enabled) {
    await ExpoHaptics.selectionAsync().catch(() => undefined);
  }
}

export function useHapticsPreference() {
  const [enabled, setEnabledState] = useState(enabledCache ?? true);
  const [ready, setReady] = useState(enabledCache !== null);

  useEffect(() => {
    let mounted = true;
    const listener = (next: boolean) => {
      if (!mounted) return;
      setEnabledState(next);
      setReady(true);
    };
    listeners.add(listener);
    void loadHapticsEnabled().then((next) => listener(next));

    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => setHapticsEnabled(next), []);
  return { enabled, ready, setEnabled };
}

async function runWhenEnabled(action: () => Promise<void>) {
  if (!(await loadHapticsEnabled())) return;
  await action().catch(() => undefined);
}

export function impactAsync(style: ExpoHaptics.ImpactFeedbackStyle) {
  return runWhenEnabled(() => ExpoHaptics.impactAsync(style));
}

export function notificationAsync(type: ExpoHaptics.NotificationFeedbackType) {
  return runWhenEnabled(() => ExpoHaptics.notificationAsync(type));
}

export function selectionAsync() {
  return runWhenEnabled(() => ExpoHaptics.selectionAsync());
}

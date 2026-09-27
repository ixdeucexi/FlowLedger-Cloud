import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useOverlayActivity } from "./useOverlayActivity";
import { createNestedOverlayHistory } from "../lib/nestedOverlayHistory";

export function useBackDismiss(active: boolean, onDismiss: () => void, blocksDailyTip = true, nestedActive?: boolean) {
  useOverlayActivity(active && blocksDailyTip);
  const onDismissRef = useRef(onDismiss);
  const nestedController = useRef<ReturnType<typeof createNestedOverlayHistory> | null>(null);
  const nestedEnabled = nestedActive !== undefined;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return;
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;

    if (nestedEnabled) {
      const controller = createNestedOverlayHistory(window, () => onDismissRef.current());
      nestedController.current = controller;
      return () => { controller.dispose(); nestedController.current = null; };
    }

    const token = `flowledger-layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ ...(window.history.state ?? {}), flowledgerLayer: token }, "", window.location.href);

    const onPopState = () => {
      onDismissRef.current();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [active, nestedEnabled]);

  useEffect(() => { nestedController.current?.setNested(Boolean(nestedActive)); }, [active, nestedActive]);
}

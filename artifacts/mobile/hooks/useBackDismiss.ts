import { useEffect, useRef } from "react";
import { Platform } from "react-native";

export function useBackDismiss(active: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return;
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;

    const token = `flowledger-layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ ...(window.history.state ?? {}), flowledgerLayer: token }, "", window.location.href);

    const onPopState = () => {
      onDismissRef.current();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [active]);
}

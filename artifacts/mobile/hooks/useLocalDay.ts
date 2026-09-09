import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { localDayKey, startLocalDayClock } from "@/lib/localDay";

/** Refresh calendar-relative UI at midnight and after suspended PWA/native resumes. */
export function useLocalDay() {
  const [day, setDay] = useState(() => localDayKey());
  useEffect(() => {
    const clock = startLocalDayClock(setDay);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") clock.refresh();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") clock.refresh();
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", clock.refresh);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clock.stop();
      subscription.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", clock.refresh);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);
  return day;
}

import { localDateInTimeZone } from "./dailyCheckingClose";

function safeDateInTimeZone(date: Date, timeZone: string): string {
  try {
    return localDateInTimeZone(date, timeZone);
  } catch {
    return localDateInTimeZone(date, "UTC");
  }
}

/** Milliseconds until the household's next local calendar-date boundary. */
export function millisecondsUntilHouseholdDateChanges(
  now: Date,
  timeZone: string,
): number {
  const nowMs = now.getTime();
  const currentDate = safeDateInTimeZone(now, timeZone);
  let low = nowMs;
  let high = nowMs + 36 * 60 * 60 * 1000;
  while (
    safeDateInTimeZone(new Date(high), timeZone) === currentDate
    && high - nowMs < 8 * 24 * 60 * 60 * 1000
  ) high += 36 * 60 * 60 * 1000;

  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (safeDateInTimeZone(new Date(middle), timeZone) === currentDate) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.max(1, high - nowMs);
}

interface HouseholdDateEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Web resume signals, including bfcache restores without visibility changes. */
export function subscribeHouseholdDateResumeEvents(input: {
  documentTarget: HouseholdDateEventTarget & { visibilityState?: string };
  windowTarget: HouseholdDateEventTarget;
  onRefresh: () => void;
}): () => void {
  const onVisibilityChange = () => {
    if (input.documentTarget.visibilityState === "visible") input.onRefresh();
  };
  input.documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  input.windowTarget.addEventListener("pageshow", input.onRefresh);
  return () => {
    input.documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    input.windowTarget.removeEventListener("pageshow", input.onRefresh);
  };
}

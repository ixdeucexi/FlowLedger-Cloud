/** Household-local schedule only. No notification registration or financial work. */
export function todayWithFloSchedule(
  now: Date,
  timeZone: string,
): {
  day: string;
  eligible: boolean;
  nextMorningAt: number;
} | null {
  if (!Number.isFinite(now.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const local = (instant: number) => {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .map((part) => [part.type, part.value]),
      );
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    };
    const current = local(now.getTime());
    const day = current.slice(0, 10);
    const eligible = current.slice(11) >= "08:00:00";
    const targetDay = eligible
      ? new Date(Date.parse(`${day}T00:00:00Z`) + 86400000)
          .toISOString()
          .slice(0, 10)
      : day;
    const target = `${targetDay}T08:00:00`;
    // Find the actual instant in this timezone, including 23/25-hour DST days.
    // This bounded clock calculation runs only after reveal/foreground, not startup.
    let low = now.getTime();
    let high = low + 36 * 60 * 60 * 1000;
    if (local(high) < target) return null;
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      if (local(middle) < target) low = middle;
      else high = middle;
    }
    return { day, eligible, nextMorningAt: high };
  } catch {
    // Never silently reinterpret an invalid household zone as UTC/device time.
    return null;
  }
}

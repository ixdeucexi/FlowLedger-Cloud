export function localDayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Calendar construction (not adding 24 hours) respects daylight-saving changes.
export function millisecondsUntilLocalMidnight(now = new Date()): number {
  return Math.max(
    1,
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() -
      now.getTime(),
  );
}

export function startLocalDayClock(
  onDay: (day: string) => void,
  now: () => Date = () => new Date(),
  schedule: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const refresh = () => {
    if (stopped) return;
    if (timer !== undefined) cancel(timer);
    const current = now();
    onDay(localDayKey(current));
    timer = schedule(refresh, millisecondsUntilLocalMidnight(current) + 50);
  };
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      if (timer !== undefined) cancel(timer);
    },
  };
}

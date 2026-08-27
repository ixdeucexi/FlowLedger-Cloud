function validTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return "UTC";
  }
}

function localDateTimeParts(now, timeZone) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid instant is required.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    timeZone: validTimeZone(timeZone),
  };
}

function isLocalCloseHour(now, timeZone, closeHour = 23) {
  return localDateTimeParts(now, timeZone).hour === closeHour;
}

function isLocalCloseWindow(now, timeZone, closeHours = [23]) {
  const hour = localDateTimeParts(now, timeZone).hour;
  return closeHours.includes(hour);
}

module.exports = { isLocalCloseHour, isLocalCloseWindow, localDateTimeParts, validTimeZone };

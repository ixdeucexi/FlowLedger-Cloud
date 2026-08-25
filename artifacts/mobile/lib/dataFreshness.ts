export type DataTimestamp = Date | number | string | null | undefined;

export function validDataTimestamp(value: DataTimestamp): Date | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function formatExactDataTimestamp(
  value: DataTimestamp,
  locale?: string,
  timeZone?: string,
): string | null {
  const parsed = validDataTimestamp(value);
  if (!parsed) return null;
  const common = timeZone ? { timeZone } : undefined;
  const date = parsed.toLocaleDateString(locale, {
    ...common,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = parsed.toLocaleTimeString(locale, {
    ...common,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}

export function dataFreshnessLabel(value: DataTimestamp): string | null {
  const timestamp = formatExactDataTimestamp(value);
  return timestamp ? `Data updated ${timestamp}` : null;
}

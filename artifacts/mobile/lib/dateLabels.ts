export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const COMPACT_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
] as const;

export function compactMonthDay(month: number, day: number): string {
  const monthLabel = COMPACT_MONTH_NAMES[month];
  if (!monthLabel || !Number.isInteger(day) || day < 1 || day > 31) return "Date unavailable";
  return `${monthLabel} ${day}`;
}

export function compactDateOnly(value: string): string {
  const date = dateOnlyToLocalDate(value);
  return date ? compactMonthDay(date.getMonth(), date.getDate()) : value;
}

export function compactDateLabel(value: string): string {
  const dateOnly = dateOnlyToLocalDate(value);
  if (dateOnly) return compactMonthDay(dateOnly.getMonth(), dateOnly.getDate());

  const match = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*\d{4})?$/.exec(value.trim());
  if (!match) return value;
  const month = MONTH_NAMES.findIndex((name, index) =>
    name.toLowerCase() === match[1].toLowerCase()
    || COMPACT_MONTH_NAMES[index].toLowerCase() === match[1].toLowerCase(),
  );
  return month >= 0 ? compactMonthDay(month, Number(match[2])) : value;
}

export function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateOnlyToLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function addDateOnlyDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addDateOnlyMonths(value: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const sourceDay = Number(match[3]);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(sourceDay, lastDay));
  return date.toISOString().slice(0, 10);
}

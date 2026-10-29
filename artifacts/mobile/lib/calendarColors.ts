export const CALENDAR_CATEGORIES = [
  { id: "income", label: "Income" },
  { id: "bill", label: "Bills" },
  { id: "debt", label: "Debt" },
  { id: "plan", label: "Plan" },
  { id: "spending", label: "Spending" },
  { id: "risk", label: "Risk" },
] as const;

export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number]["id"];
export const CALENDAR_COLOR_CHOICES = [
  { id: "green", name: "Green", dark: "#4ade80", light: "#15803d" },
  { id: "amber", name: "Amber", dark: "#fbbf24", light: "#a16207" },
  { id: "blue", name: "Blue", dark: "#60a5fa", light: "#2563eb" },
  { id: "violet", name: "Violet", dark: "#a78bfa", light: "#7c3aed" },
  { id: "teal", name: "Teal", dark: "#2dd4bf", light: "#0f766e" },
  { id: "rose", name: "Rose", dark: "#fb7185", light: "#be123c" },
  { id: "slate", name: "Slate", dark: "#94a3b8", light: "#475569" },
  { id: "cyan", name: "Cyan", dark: "#22d3ee", light: "#0e7490" },
] as const;
export type CalendarColorChoice = (typeof CALENDAR_COLOR_CHOICES)[number]["id"];
export type CalendarColorOverrides = Partial<
  Record<CalendarCategory, CalendarColorChoice>
>;

/** Closed cosmetic fields only; empty overrides mean all colors follow theme. */
export function normalizeCalendarColors(
  value: unknown,
): CalendarColorOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const result: CalendarColorOverrides = {};
  for (const category of CALENDAR_CATEGORIES) {
    const choice = CALENDAR_COLOR_CHOICES.find(
      (color) => color.id === input[category.id],
    );
    if (choice) result[category.id] = choice.id;
  }
  return Object.keys(result).length ? result : undefined;
}

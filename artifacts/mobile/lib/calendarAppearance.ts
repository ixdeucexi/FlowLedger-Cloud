import {
  contrastRatio,
  mixColor,
  type AppearancePreferences,
} from "./appearance";
import {
  CALENDAR_COLOR_CHOICES,
  type CalendarCategory,
} from "./calendarColors";

export type CalendarChipKind = CalendarCategory | "goal" | "expense";
export interface CalendarTone {
  color: string;
  bg: string;
  border: string;
  text: string;
}
export type CalendarAppearance = Record<CalendarCategory, CalendarTone>;

export function calendarHighlightText(fill: string) {
  return contrastRatio(fill, "#ffffff") >= 4.5 ? "#ffffff" : "#020617";
}

/** Scope legacy desktop accent variable names to the Forecast page only. */
export function calendarAccentVariables(colors: {
  primary: string;
  background: string;
}) {
  return {
    "--fl-desktop-purple": colors.primary,
    "--fl-desktop-purple-strong": colors.primary,
    "--fl-desktop-purple-soft": mixColor(
      colors.background,
      colors.primary,
      0.1,
    ),
  };
}

export function calendarCategory(kind: CalendarChipKind): CalendarCategory {
  return kind === "goal" ? "plan" : kind === "expense" ? "spending" : kind;
}

/** Rendering only: never changes event classification, amounts or risk thresholds. */
export function calendarAppearance(
  mode: "dark" | "light",
  appearance: AppearancePreferences,
  colors: { primary: string; background: string; foreground: string },
): CalendarAppearance {
  const dark = mode === "dark";
  const defaults: Record<CalendarCategory, string> = {
    income: dark ? "#4ade80" : "#15803d",
    bill: dark ? "#fbbf24" : "#a16207",
    debt: dark ? "#60a5fa" : "#2563eb",
    plan: mixColor(colors.primary, dark ? "#c4b5fd" : "#7c3aed", 0.24),
    spending: mixColor(colors.primary, dark ? "#a5b4fc" : "#4338ca", 0.45),
    risk: dark ? "#fb7185" : "#be123c",
  };
  const result = {} as CalendarAppearance;
  for (const kind of Object.keys(defaults) as CalendarCategory[]) {
    const custom = CALENDAR_COLOR_CHOICES.find(
      (choice) => choice.id === appearance.calendarColors?.[kind],
    );
    const color = custom ? custom[mode] : defaults[kind];
    const bg = mixColor(colors.background, color, dark ? 0.18 : 0.1);
    const text =
      contrastRatio(colors.foreground, bg) >= 4.5
        ? colors.foreground
        : contrastRatio("#ffffff", bg) >= contrastRatio("#020617", bg)
          ? "#ffffff"
          : "#020617";
    result[kind] = { color, bg, border: mixColor(bg, color, 0.72), text };
  }
  return result;
}

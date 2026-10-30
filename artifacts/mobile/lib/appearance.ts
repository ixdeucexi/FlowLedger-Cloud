import {
  normalizeCalendarColors,
  type CalendarColorOverrides,
} from "./calendarColors";
export type ThemeMode = "auto" | "dark" | "light";
export type AccentChoice =
  | "default"
  | "blue"
  | "teal"
  | "rose"
  | "amber"
  | "slate";
export type BackdropChoice = "ambient" | "subtle" | "plain";
export type AppearanceContrast = "standard" | "high";
export interface AppearancePreferences {
  version: 1;
  themeMode: ThemeMode;
  accent: AccentChoice;
  backdrop: BackdropChoice;
  contrast: AppearanceContrast;
  calendarColors?: CalendarColorOverrides;
}
export const APPEARANCE_STORAGE_KEY = "@flowledger_appearance_v1";
export const LEGACY_THEME_STORAGE_KEY = "@app_theme_v1";
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  version: 1,
  themeMode: "dark",
  accent: "default",
  backdrop: "ambient",
  contrast: "standard",
};
export const ACCENT_CHOICES: readonly {
  id: AccentChoice;
  name: string;
  color: string;
  darkColor: string;
}[] = [
  { id: "default", name: "Original", color: "#2f6fff", darkColor: "#9f5cff" },
  { id: "blue", name: "Blue", color: "#2563eb", darkColor: "#4371d4" },
  { id: "teal", name: "Teal", color: "#0f766e", darkColor: "#178577" },
  { id: "rose", name: "Rose", color: "#be185d", darkColor: "#c44378" },
  { id: "amber", name: "Amber", color: "#92400e", darkColor: "#a3671d" },
  { id: "slate", name: "Slate", color: "#475569", darkColor: "#68758a" },
];
export const APPEARANCE_PRESETS: readonly {
  id: string;
  name: string;
  description: string;
  preferences: AppearancePreferences;
}[] = [
  {
    id: "flowledger",
    name: "FlowLedger",
    description: "The original violet glow",
    preferences: DEFAULT_APPEARANCE,
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue, calm and focused",
    preferences: { ...DEFAULT_APPEARANCE, accent: "blue" },
  },
  {
    id: "mint",
    name: "Mint",
    description: "Fresh teal on a light canvas",
    preferences: {
      ...DEFAULT_APPEARANCE,
      themeMode: "light",
      accent: "teal",
      backdrop: "subtle",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm rose after dark",
    preferences: { ...DEFAULT_APPEARANCE, accent: "rose" },
  },
  {
    id: "paper",
    name: "Paper",
    description: "A clean, simple light look",
    preferences: {
      ...DEFAULT_APPEARANCE,
      themeMode: "light",
      accent: "blue",
      backdrop: "plain",
    },
  },
];
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "auto";
}
export function normalizeAppearance(
  value: unknown,
  legacyTheme?: unknown,
): AppearancePreferences {
  const fallback: AppearancePreferences = {
    ...DEFAULT_APPEARANCE,
    themeMode: isThemeMode(legacyTheme) ? legacyTheme : "dark",
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fallback;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return fallback;
  const calendarColors = normalizeCalendarColors(v.calendarColors);
  return {
    version: 1,
    themeMode: isThemeMode(v.themeMode) ? v.themeMode : fallback.themeMode,
    accent: ACCENT_CHOICES.some((x) => x.id === v.accent)
      ? (v.accent as AccentChoice)
      : "default",
    backdrop:
      v.backdrop === "subtle" || v.backdrop === "plain"
        ? v.backdrop
        : "ambient",
    contrast: v.contrast === "high" ? "high" : "standard",
    ...(calendarColors ? { calendarColors } : {}),
  };
}
export function parseAppearance(
  raw: string | null,
  legacyTheme?: unknown,
): AppearancePreferences {
  try {
    return normalizeAppearance(
      raw && raw.length <= 2048 ? JSON.parse(raw) : null,
      legacyTheme,
    );
  } catch {
    return normalizeAppearance(null, legacyTheme);
  }
}
export function appearancePreset(p: AppearancePreferences) {
  if (p.calendarColors && Object.keys(p.calendarColors).length) return null;
  return appearanceBasePreset(p);
}
/** Calendar colors are independent of the selected app preset. */
export function appearanceBasePreset(p: AppearancePreferences) {
  return (
    APPEARANCE_PRESETS.find(
      (x) =>
        x.preferences.themeMode === p.themeMode &&
        x.preferences.accent === p.accent &&
        x.preferences.backdrop === p.backdrop &&
        x.preferences.contrast === p.contrast,
    ) ?? null
  );
}
export function mixColor(left: string, right: string, amount: number) {
  const rgb = (s: string) =>
    [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const a = rgb(left),
    b = rgb(right);
  return (
    "#" +
    a
      .map((n, i) =>
        Math.round(n + (b[i] - n) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function relativeLuminance(hex: string) {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const x = relativeLuminance(a),
    y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function appearancePalette<
  T extends { primary: string; background: string },
>(mode: "dark" | "light", p: AppearancePreferences, base: T) {
  const dark = mode === "dark",
    accent = ACCENT_CHOICES.find((a) => a.id === p.accent) ?? ACCENT_CHOICES[0];
  const primary =
    p.accent === "default"
      ? base.primary
      : dark
        ? accent.darkColor
        : accent.color;
  const primaryForeground =
    contrastRatio(primary, "#ffffff") >= 4.5 ? "#ffffff" : "#020617";
  return {
    ...base,
    ...(p.accent !== "default"
      ? {
          primary,
          primaryForeground,
          tint: primary,
          background: mixColor(base.background, primary, dark ? 0.025 : 0.035),
          secondary: mixColor(
            dark ? "#101522" : "#ffffff",
            primary,
            dark ? 0.16 : 0.09,
          ),
          secondaryForeground: dark
            ? mixColor(primary, "#ffffff", 0.7)
            : primary,
          accent: primary,
          accentForeground: primaryForeground,
        }
      : {}),
    ...(p.contrast === "high"
      ? {
          foreground: dark ? "#ffffff" : "#101828",
          text: dark ? "#ffffff" : "#101828",
          cardForeground: dark ? "#ffffff" : "#101828",
          mutedForeground: dark ? "#d0d5dd" : "#344054",
          border: dark ? "#758195" : "#667085",
          card: dark ? "#080c14" : "#ffffff",
          input: dark ? "#080c14" : "#ffffff",
        }
      : {}),
  };
}
/** Serialize device writes so a slower old choice cannot replace a newer one. */
export function createAppearanceWriter(
  write: (value: AppearancePreferences) => Promise<void>,
) {
  let tail = Promise.resolve();
  return (value: AppearancePreferences) => {
    const next = {
      ...value,
      ...(value.calendarColors
        ? { calendarColors: { ...value.calendarColors } }
        : {}),
    };
    const operation = tail.catch(() => {}).then(() => write(next));
    tail = operation.catch(() => {});
    return operation;
  };
}

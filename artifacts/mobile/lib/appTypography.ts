import type { AppFontStyle } from "@/context/ThemeContext";

export function fontFamilyForStyle(style: AppFontStyle): string {
  void style;
  return "'Inter_400Regular', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

export function nativeFontFamilyForStyle(style: AppFontStyle): string {
  void style;
  return "Inter_400Regular";
}

/**
 * Map React Native's weight values to the bundled Inter faces. Keeping the
 * family explicit avoids platform fallback while preserving the hierarchy
 * already expressed by existing component styles.
 */
export function fontFamilyForWeight(
  weight: string | number | undefined,
  native: boolean,
): string {
  const normalized = String(weight ?? "400");
  const face =
    normalized === "800" || normalized === "900"
      ? "Inter_800ExtraBold"
      : normalized === "700" || normalized === "bold"
        ? "Inter_700Bold"
        : normalized === "600" || normalized === "semibold"
          ? "Inter_600SemiBold"
          : normalized === "500" || normalized === "medium"
            ? "Inter_500Medium"
            : "Inter_400Regular";
  return native ? face : `'${face}', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
}

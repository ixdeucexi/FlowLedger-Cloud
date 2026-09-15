import type { AppFontStyle } from "@/context/ThemeContext";

export function fontFamilyForStyle(style: AppFontStyle): string {
  void style;
  return "'Inter_400Regular', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

export function nativeFontFamilyForStyle(style: AppFontStyle): string {
  void style;
  return "Inter_400Regular";
}

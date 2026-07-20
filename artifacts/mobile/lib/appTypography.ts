import type { AppFontStyle } from "@/context/ThemeContext";

export function fontFamilyForStyle(style: AppFontStyle): string {
  switch (style) {
    case "elegant":
      return "Georgia, 'Times New Roman', serif";
    case "bold":
      return "'Inter_700Bold', Arial, sans-serif";
    case "playful":
      return "'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif";
    case "soft":
      return "'Avenir Next', 'Segoe UI', 'Inter_400Regular', sans-serif";
    case "default":
    default:
      return "'Inter_400Regular', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  }
}

export function nativeFontFamilyForStyle(style: AppFontStyle): string | undefined {
  switch (style) {
    case "elegant":
      return "serif";
    case "bold":
      return "sans-serif-medium";
    case "playful":
      return "sans-serif";
    case "soft":
      return "sans-serif";
    case "default":
    default:
      return undefined;
  }
}

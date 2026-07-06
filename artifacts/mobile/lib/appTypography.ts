import type { AppFontStyle } from "@/context/ThemeContext";

export function fontFamilyForStyle(style: AppFontStyle): string {
  switch (style) {
    case "elegant":
      return "Georgia, 'Times New Roman', serif";
    case "bold":
      return "'Arial Black', Impact, 'Inter_700Bold', sans-serif";
    case "playful":
      return "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive";
    case "soft":
      return "'Trebuchet MS', 'Avenir Next', 'Segoe UI Rounded', sans-serif";
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
      return "sans-serif-condensed";
    case "playful":
      return "casual";
    case "soft":
      return "sans-serif-light";
    case "default":
    default:
      return undefined;
  }
}

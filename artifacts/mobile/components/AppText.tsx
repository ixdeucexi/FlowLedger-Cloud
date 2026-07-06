import React from "react";
import { Platform, Text, type TextProps, type TextStyle } from "react-native";

import { type AppFontStyle, useThemeMode } from "@/context/ThemeContext";
import { fontFamilyForStyle, nativeFontFamilyForStyle } from "@/lib/appTypography";

export type AppTextTone = "body" | "title" | "label" | "number" | "button" | "flo";

type AppTextProps = TextProps & {
  tone?: AppTextTone;
  fontStyleOverride?: AppFontStyle;
};

function getFontFamily(style: AppFontStyle): string | undefined {
  if (style === "default") return undefined;
  return Platform.OS === "web" ? fontFamilyForStyle(style) : nativeFontFamilyForStyle(style);
}

function toneStyle(tone: AppTextTone): TextStyle | undefined {
  switch (tone) {
    case "title":
      return { letterSpacing: -0.3 };
    case "label":
      return { letterSpacing: 0.7, textTransform: "uppercase" };
    case "number":
      return { letterSpacing: -1 };
    case "button":
      return { letterSpacing: 0 };
    case "flo":
      return { letterSpacing: -0.1 };
    case "body":
    default:
      return undefined;
  }
}

export function AppText({ tone = "body", fontStyleOverride, style, ...props }: AppTextProps) {
  const { fontStyle } = useThemeMode();
  const selectedStyle = fontStyleOverride ?? fontStyle;
  const fontFamily = getFontFamily(selectedStyle);
  const dynamicStyle = fontFamily ? { fontFamily } : undefined;

  return <Text {...props} style={[style, toneStyle(tone), dynamicStyle]} />;
}

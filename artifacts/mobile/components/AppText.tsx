import React from "react";
import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from "react-native";

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
  const flattened = StyleSheet.flatten(style) ?? {};
  const baseFontSize = typeof flattened.fontSize === "number" ? flattened.fontSize : 14;
  const scale = selectedStyle === "bold" ? 0.92 : selectedStyle === "playful" ? 0.94 : selectedStyle === "elegant" ? 0.96 : 1;
  const lineHeightRatio = tone === "number" ? 1.08 : tone === "title" ? 1.18 : tone === "label" ? 1.25 : 1.34;
  const dynamicStyle: TextStyle = {
    ...(fontFamily ? { fontFamily } : {}),
    ...(selectedStyle === "default" ? {} : { fontSize: Math.max(8, Math.round(baseFontSize * scale * 10) / 10) }),
    ...(typeof flattened.lineHeight === "number" ? {} : { lineHeight: Math.ceil(baseFontSize * lineHeightRatio) }),
  };

  return <Text {...props} style={[style, toneStyle(tone), dynamicStyle]} />;
}

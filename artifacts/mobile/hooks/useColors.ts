import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { useThemeMode } from "@/context/ThemeContext";

export function useColors() {
  const scheme = useColorScheme();
  const { themeMode } = useThemeMode();

  const effective = themeMode === "auto" ? scheme : themeMode;
  const palette =
    effective === "dark" && "dark" in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}

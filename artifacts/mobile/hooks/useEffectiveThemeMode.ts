import { useColorScheme } from "react-native";

import { ThemeMode, useThemeMode } from "@/context/ThemeContext";

export type EffectiveThemeMode = Exclude<ThemeMode, "auto">;

export function useEffectiveThemeMode(): EffectiveThemeMode {
  const scheme = useColorScheme();
  const { themeMode } = useThemeMode();

  if (themeMode === "auto") {
    return scheme === "dark" ? "dark" : "light";
  }

  return themeMode;
}

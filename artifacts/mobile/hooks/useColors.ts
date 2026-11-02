import colors from "@/constants/colors";
import { useMemo } from "react";
import { useThemeMode } from "@/context/ThemeContext";
import { appearancePalette } from "@/lib/appearance";
import { useEffectiveThemeMode } from "@/hooks/useEffectiveThemeMode";

export function useColors() {
  const effective = useEffectiveThemeMode();
  const { appearance } = useThemeMode();
  const palette = useMemo(
    () => appearancePalette(effective, appearance, colors[effective]),
    [effective, appearance],
  );
  return { ...palette, radius: colors.radius, mode: effective, isDark: effective === "dark" };
}

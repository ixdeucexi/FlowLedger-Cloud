import colors from "@/constants/colors";
import { useEffectiveThemeMode } from "@/hooks/useEffectiveThemeMode";

export function useColors() {
  const effective = useEffectiveThemeMode();
  const palette =
    effective === "dark" && "dark" in colors
      ? colors.dark
      : colors.light;
  return { ...palette, radius: colors.radius, mode: effective, isDark: effective === "dark" };
}

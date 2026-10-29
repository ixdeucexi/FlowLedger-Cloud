import { useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { calendarAppearance } from "@/lib/calendarAppearance";

export function useCalendarAppearance() {
  const c = useColors();
  const { appearance } = useThemeMode();
  return calendarAppearance(c.mode, appearance, c);
}

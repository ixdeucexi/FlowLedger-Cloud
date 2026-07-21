import type { TextStyle, ViewStyle } from "react-native";

export const SETTINGS_STACK_BREAKPOINT = 480;

export type ForecastSafetyLayout = {
  stacked: boolean;
  fields: ViewStyle;
  field: ViewStyle;
  input: TextStyle;
};

export function getForecastSafetyLayout(viewportWidth: number): ForecastSafetyLayout {
  const stacked = viewportWidth < SETTINGS_STACK_BREAKPOINT;

  return {
    stacked,
    fields: stacked
      ? { width: "100%", flexDirection: "column", alignItems: "stretch", gap: 12 }
      : { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 10 },
    field: stacked
      ? { width: "100%", minWidth: 0 }
      : { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    input: { width: "100%", minHeight: 48 },
  };
}

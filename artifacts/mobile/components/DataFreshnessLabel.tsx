import type { StyleProp, ViewStyle } from "react-native";

export function DataFreshnessLabel(_props: {
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  inset?: boolean;
}) {
  // Freshness is still tracked for sync and retry behavior, but the timestamp
  // is intentionally hidden from the primary UI to keep headers focused.
  return null;
}

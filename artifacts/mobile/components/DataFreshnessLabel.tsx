import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { dataFreshnessLabel } from "@/lib/dataFreshness";

export function DataFreshnessLabel({
  style,
  compact = false,
  inset = false,
}: {
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  inset?: boolean;
}) {
  const colors = useColors();
  const { dataUpdatedAt } = useBudget();
  const label = dataFreshnessLabel(dataUpdatedAt);

  if (!label) return null;

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.row, compact && styles.compact, inset && styles.inset, style]}
    >
      <Feather name="clock" size={compact ? 11 : 12} color={colors.mutedForeground} />
      <Text style={[styles.text, compact && styles.compactText, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compact: { gap: 5 },
  inset: { paddingHorizontal: 22, marginTop: -4, marginBottom: 12 },
  text: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_600SemiBold",
  },
  compactText: { fontSize: 10, lineHeight: 14 },
});

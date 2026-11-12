import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

/** A small entry point; full schedule management lives on the Transfers page. */
export function TransferPlansShortcut() {
  const c = useColors();
  const router = useRouter();
  const {
    activeHousehold,
    plannedAccountTransfers,
    plannedTransfersReady,
    plannedTransfersError,
  } = useBudget();
  const count = plannedAccountTransfers.filter(plan =>
    plan.household_id === activeHousehold?.householdId
    && plan.budget_id === activeHousehold?.budgetId
    && !plan.deleted_at,
  ).length;
  const summary = plannedTransfersError
    ? "Transfer plans need attention"
    : !plannedTransfersReady
      ? "Loading transfer plans…"
      : count
        ? `${count} ${count === 1 ? "plan" : "plans"} between your accounts`
        : "Plan between your accounts";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open transfers. ${summary}`}
      onPress={() => router.push("/(tabs)/transfers")}
      style={({ pressed }) => [styles.row, {
        backgroundColor: c.card,
        borderColor: c.border,
        opacity: pressed ? 0.75 : 1,
      }]}
    >
      <View style={[styles.icon, { backgroundColor: c.primary + "14" }]}>
        <Feather name="repeat" size={19} color={c.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: c.foreground }]}>Transfers</Text>
        <Text style={[styles.summary, { color: plannedTransfersError ? c.warning : c.mutedForeground }]}>
          {summary}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={c.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 76, borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_700Bold" },
  summary: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
});

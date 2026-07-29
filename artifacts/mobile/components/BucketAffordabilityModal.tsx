import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import type { GoalAffordability } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { buildBucketAffordabilitySummary } from "@/lib/bucketAffordability";

type Props = {
  visible: boolean;
  bucketName: string;
  amount: number;
  targetDate: string;
  safetyFloor: number;
  result: GoalAffordability | null;
  onClose: () => void;
};

export function BucketAffordabilityModal({
  visible,
  bucketName,
  amount,
  targetDate,
  safetyFloor,
  result,
  onClose,
}: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const summary = result
    ? buildBucketAffordabilitySummary(bucketName, amount, targetDate, safetyFloor, result)
    : null;

  if (!summary) return null;
  const statusColor = summary.safe ? "#22c55e" : "#f59e0b";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: statusColor + "88" }]}>
          <View style={styles.logoRow}>
            <FloLogo size={70} />
            <View style={[styles.statusIcon, { backgroundColor: statusColor }]}>
              <Feather name={summary.safe ? "check" : "alert-triangle"} size={18} color="#fff" />
            </View>
          </View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo checked your plan</Text>
          <Text style={[styles.title, { color: c.foreground }]}>{summary.title}</Text>
          <Text style={[styles.message, { color: c.mutedForeground }]}>{summary.message}</Text>
          <View style={[styles.result, { backgroundColor: c.background, borderColor: c.border }]}>
            <Text style={[styles.resultLabel, { color: c.mutedForeground }]}>{summary.statusLabel}</Text>
            <Text style={[styles.resultValue, { color: statusColor }]}>{summary.statusValue}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Flo affordability check"
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: c.primaryForeground }]}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.76)",
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    shadowColor: "#22d3ee",
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  logoRow: { alignItems: "center", justifyContent: "center" },
  statusIcon: {
    position: "absolute",
    right: "31%",
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0f172a",
  },
  eyebrow: {
    marginTop: 14,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
  },
  title: {
    marginTop: 7,
    textAlign: "center",
    fontSize: 23,
    lineHeight: 29,
    fontFamily: "Inter_800ExtraBold",
  },
  message: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_500Medium",
  },
  result: {
    marginTop: 17,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  resultLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  resultValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  buttonText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});

import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";

export interface FullPaymentPromptDetails {
  billName: string;
  budgeted: number;
  actual: number;
}

interface Props {
  visible: boolean;
  prompt: FullPaymentPromptDetails | null;
  onClose: () => void;
  onKeepPartial: () => void;
  onFullPayment: () => void;
}

export function FullPaymentPromptModal({ visible, prompt, onClose, onKeepPartial, onFullPayment }: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const difference = prompt ? Math.max(0, prompt.budgeted - prompt.actual) : 0;
  const fmt = (amount: number) => `$${amount.toFixed(2)}`;

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          accessibilityRole="summary"
          onPress={(event) => event.stopPropagation()}
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <View style={styles.floWrap}>
            <FloLogo size={74} />
          </View>
          <Text style={[styles.eyebrow, { color: c.primary }]}>Flo can help</Text>
          <Text style={[styles.message, { color: c.foreground }]}>
            Was {fmt(prompt?.actual ?? 0)} the full payment for {prompt?.billName ?? "this bill"}?
          </Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            I see it was planned for {fmt(prompt?.budgeted ?? 0)}. If this was the full amount, I can help route the {fmt(difference)} left over.
          </Text>

          <View style={[styles.amountBox, { backgroundColor: c.background + "88", borderColor: c.border }]}>
            <View style={styles.amountRow}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>Budgeted</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{fmt(prompt?.budgeted ?? 0)}</Text></View>
            <View style={styles.amountRow}><Text style={[styles.amountLabel, { color: c.mutedForeground }]}>Actual</Text><Text style={[styles.amountValue, { color: c.foreground }]}>{fmt(prompt?.actual ?? 0)}</Text></View>
            <View style={styles.amountRow}><Text style={[styles.amountLabel, { color: c.success }]}>Available</Text><Text style={[styles.amountValue, { color: c.success }]}>{fmt(difference)}</Text></View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm this was the full bill payment"
            onPress={onFullPayment}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
          >
            <Feather name="check-circle" size={18} color={c.primaryForeground} />
            <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>Yes</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Keep this as a partial bill payment"
            onPress={onKeepPartial}
            style={({ pressed }) => [styles.secondaryButton, { borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <Text style={[styles.secondaryButtonText, { color: c.foreground }]}>No, keep it partial</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    paddingTop: 24,
    paddingBottom: 22,
    shadowColor: "#2563eb",
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  floWrap: { alignItems: "center" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, textTransform: "uppercase", textAlign: "center", marginTop: 12 },
  message: { fontSize: 21, fontFamily: "Inter_800ExtraBold", lineHeight: 28, textAlign: "center", marginTop: 10 },
  sub: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 7 },
  amountBox: { width: "100%", borderWidth: 1, borderRadius: 16, padding: 14, gap: 9, marginTop: 18, marginBottom: 18 },
  amountRow: { flexDirection: "row", justifyContent: "space-between" },
  amountLabel: { fontSize: 13 },
  amountValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  primaryButton: { width: "100%", minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  primaryButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  secondaryButton: { width: "100%", minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

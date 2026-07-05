import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type { SafetyStopWarning } from "@/lib/safetyStop";

interface Props {
  visible: boolean;
  warning: SafetyStopWarning | null;
  onKeepEditing: () => void;
  onScheduleAnyway?: () => void;
}

function formatMoney(value: number) {
  const rounded = Math.round(value);
  return `$${rounded.toLocaleString()}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FloSafetyStopModal({ visible, warning, onKeepEditing, onScheduleAnyway }: Props) {
  const c = useColors();
  useBackDismiss(visible, onKeepEditing);
  if (!warning) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onKeepEditing}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: "rgba(248,113,113,0.65)" }]}>
          <View style={styles.topRow}>
            <View style={styles.floWrap}>
              <FloLogo size={62} />
            </View>
            <View style={styles.stopBadge}>
              <Feather name="octagon" size={24} color="#fee2e2" />
            </View>
          </View>
          <Text style={styles.eyebrow}>Flo safety stop</Text>
          <Text style={[styles.title, { color: c.foreground }]}>This would go below your safety floor.</Text>
          <Text style={[styles.message, { color: c.mutedForeground }]}>
            I’m stopping here because scheduling {warning.itemName} for {formatDate(warning.scheduledDate)} would drop your forecast to {formatMoney(warning.lowestBalance)} on {formatDate(warning.lowestBalanceDate)}. Your safety floor is {formatMoney(warning.safetyFloor)}.
          </Text>
          <View style={[styles.breakdown, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Safety floor</Text>
              <Text style={[styles.rowValue, { color: c.foreground }]}>{formatMoney(warning.safetyFloor)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Lowest forecast</Text>
              <Text style={[styles.rowValue, { color: "#fb7185" }]}>{formatMoney(warning.lowestBalance)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Short by</Text>
              <Text style={[styles.rowValue, { color: "#fb7185" }]}>{formatMoney(warning.shortfall)}</Text>
            </View>
          </View>
          <Pressable onPress={onKeepEditing} style={styles.primary}>
            <Feather name="edit-3" size={16} color="#fff" />
            <Text style={styles.primaryText}>Keep editing</Text>
          </Pressable>
          {onScheduleAnyway ? (
            <Pressable onPress={onScheduleAnyway} style={[styles.secondary, { borderColor: c.border }]}>
              <Text style={[styles.secondaryText, { color: c.mutedForeground }]}>Schedule anyway</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.76)" },
  card: { borderRadius: 28, borderWidth: 1, padding: 20, paddingTop: 22, shadowColor: "#ef4444", shadowOpacity: 0.42, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 14 },
  topRow: { alignItems: "center", justifyContent: "center" },
  floWrap: { alignItems: "center" },
  stopBadge: { position: "absolute", right: "32%", top: -2, width: 44, height: 44, borderRadius: 22, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(254,226,226,0.6)" },
  eyebrow: { color: "#fb7185", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2, textTransform: "uppercase", textAlign: "center", marginTop: 13 },
  title: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", textAlign: "center", marginTop: 8 },
  message: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10 },
  breakdown: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 9, marginTop: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  rowLabel: { fontSize: 13 },
  rowValue: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  primary: { height: 52, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18, backgroundColor: "#dc2626" },
  primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  secondary: { height: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});


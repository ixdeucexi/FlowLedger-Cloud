import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  billName: string;
  budgeted: number;
  actual: number;
  targetDebt?: string;
  snowballSafe: boolean;
  onKeep: () => void;
  onSnowball: () => void;
  onClose: () => void;
}

export function BillSurplusModal({ visible, billName, budgeted, actual, targetDebt, snowballSafe, onKeep, onSnowball, onClose }: Props) {
  const c = useColors();
  const difference = Math.max(0, budgeted - actual);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.background }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={styles.iconRow}><View style={[styles.icon, { backgroundColor: c.success + "18" }]}><Feather name="trending-down" size={22} color={c.success} /></View></View>
          <Text style={[styles.title, { color: c.foreground }]}>${difference.toFixed(2)} under budget</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>{billName} was budgeted at ${budgeted.toFixed(2)} and finalized at ${actual.toFixed(2)}.</Text>
          <View style={[styles.breakdown, { backgroundColor: c.card }]}> 
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Budgeted</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${budgeted.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.mutedForeground }]}>Actual</Text><Text style={[styles.rowValue, { color: c.foreground }]}>${actual.toFixed(2)}</Text></View>
            <View style={styles.row}><Text style={[styles.rowLabel, { color: c.success }]}>Available</Text><Text style={[styles.rowValue, { color: c.success }]}>${difference.toFixed(2)}</Text></View>
          </View>
          {!targetDebt && <Text style={[styles.note, { color: c.mutedForeground }]}>No debt is currently included in your snowball.</Text>}
          {targetDebt && !snowballSafe && <Text style={[styles.note, { color: c.warning }]}>Keep this money available to preserve your $200 six-month buffer.</Text>}
          <Pressable disabled={!targetDebt || !snowballSafe} onPress={onSnowball} style={[styles.primary, { backgroundColor: targetDebt && snowballSafe ? c.primary : c.muted }]}> 
            <Feather name="zap" size={16} color={targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground} />
            <Text style={[styles.primaryText, { color: targetDebt && snowballSafe ? c.primaryForeground : c.mutedForeground }]}>Add ${difference.toFixed(2)} to {targetDebt ?? "Snowball"}</Text>
          </Pressable>
          <Pressable onPress={onKeep} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.secondaryText, { color: c.foreground }]}>Keep ${difference.toFixed(2)} available</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingTop: 12, paddingBottom: 34 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 18 }, iconRow: { alignItems: "center" }, icon: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 10 }, sub: { fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 5 },
  breakdown: { borderRadius: 12, padding: 14, gap: 9, marginTop: 16 }, row: { flexDirection: "row", justifyContent: "space-between" }, rowLabel: { fontSize: 13 }, rowValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  note: { fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 12 }, primary: { height: 50, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 16 }, primaryText: { fontSize: 14, fontFamily: "Inter_700Bold" }, secondary: { height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 10 }, secondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});


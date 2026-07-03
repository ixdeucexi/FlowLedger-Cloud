import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import type { SnowballAllocation } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";

interface Props {
  visible: boolean;
  onClose: () => void;
  method: "snowball" | "avalanche";
  onRun: (amount: number) => SnowballAllocation[];
}

export function SnowballModal({ visible, onClose, method, onRun }: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const [amount, setAmount] = useState("");
  const [results, setResults] = useState<SnowballAllocation[]>([]);
  const [ran, setRan] = useState(false);

  const handleRun = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const allocs = onRun(parsed);
    setResults(allocs);
    setRan(true);
  };

  const handleClose = () => {
    setAmount("");
    setResults([]);
    setRan(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: c.foreground }]}>
                {method === "snowball" ? "Debt Snowball" : "Debt Avalanche"}
              </Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
                {method === "snowball" ? "Smallest balance first" : "Highest interest first"}
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {!ran ? (
              <>
                <Text style={[styles.label, { color: c.mutedForeground }]}>Extra Payment Amount ($)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor={c.mutedForeground}
                  keyboardType="decimal-pad"
                />
                <Text style={[styles.desc, { color: c.mutedForeground }]}>
                  Funds will be automatically allocated to your debts using the {method} method. Balances will be updated.
                </Text>
                <Pressable
                  onPress={handleRun}
                  style={({ pressed }) => [styles.runBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Feather name="zap" size={18} color={c.primaryForeground} />
                  <Text style={[styles.runBtnText, { color: c.primaryForeground }]}>Run Engine</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.resultsTitle, { color: c.foreground }]}>Allocation Results</Text>
                {results.length === 0 ? (
                  <Text style={[styles.noDebts, { color: c.mutedForeground }]}>No active debts found.</Text>
                ) : (
                  results.map((alloc, i) => (
                    <View key={i} style={[styles.allocCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
                      <View style={styles.allocHeader}>
                        <Text style={[styles.allocName, { color: c.foreground }]}>{alloc.billName}</Text>
                        {alloc.paidOff ? (
                          <View style={[styles.paidOffBadge, { backgroundColor: c.success }]}>
                            <Text style={styles.paidOffText}>PAID OFF!</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.allocRow}>
                        <View style={styles.allocItem}>
                          <Text style={[styles.allocLabel, { color: c.mutedForeground }]}>Payment</Text>
                          <Text style={[styles.allocValue, { color: c.primary }]}>${alloc.payment.toFixed(2)}</Text>
                        </View>
                        <View style={styles.allocItem}>
                          <Text style={[styles.allocLabel, { color: c.mutedForeground }]}>Before</Text>
                          <Text style={[styles.allocValue, { color: c.foreground }]}>${alloc.balanceBefore.toFixed(2)}</Text>
                        </View>
                        <View style={styles.allocItem}>
                          <Text style={[styles.allocLabel, { color: c.mutedForeground }]}>After</Text>
                          <Text style={[styles.allocValue, { color: alloc.paidOff ? c.success : c.foreground }]}>
                            ${alloc.balanceAfter.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
                        <View style={[styles.progressFill, { backgroundColor: alloc.paidOff ? c.success : c.primary, width: `${alloc.paidOff ? 100 : ((alloc.balanceBefore - alloc.balanceAfter) / alloc.balanceBefore) * 100}%` as any }]} />
                      </View>
                    </View>
                  ))
                )}
                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [styles.doneBtn, { backgroundColor: c.muted, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={[styles.doneBtnText, { color: c.foreground }]}>Done</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  desc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 10, lineHeight: 18 },
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, marginTop: 20, marginBottom: 8 },
  runBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resultsTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 12 },
  noDebts: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 },
  allocCard: { padding: 14, marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  allocHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  allocName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  paidOffBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  paidOffText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  allocRow: { flexDirection: "row", marginBottom: 10 },
  allocItem: { flex: 1, alignItems: "center" },
  allocLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  allocValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  progressBg: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  doneBtn: { height: 50, alignItems: "center", justifyContent: "center", marginTop: 16, marginBottom: 8 },
  doneBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

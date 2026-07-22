import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Transaction } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";

interface UnplannedChargeModalProps {
  visible: boolean;
  transaction: Transaction | null;
  categories: string[];
  saving: boolean;
  onClose: () => void;
  onSaveOneTime: (category: string) => void;
  onCreateBill: () => void;
}

function money(value: number) {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function transactionName(transaction: Transaction) {
  return transaction.merchant_name?.trim() || transaction.note?.trim() || transaction.category || "Bank charge";
}

export function UnplannedChargeModal({ visible, transaction, categories, saving, onClose, onSaveOneTime, onCreateBill }: UnplannedChargeModalProps) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const categoryOptions = useMemo(() => categories.filter(category => category !== "Income"), [categories]);
  const [selectedCategory, setSelectedCategory] = useState("Other");

  useEffect(() => {
    if (!visible || !transaction) return;
    const suggested = transaction.category && transaction.category !== "Income" ? transaction.category : "Other";
    setSelectedCategory(categoryOptions.includes(suggested) ? suggested : categoryOptions[0] ?? "Other");
  }, [categoryOptions, transaction, visible]);

  if (!transaction) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: c.primary }]}>FORGOTTEN EXPENSE</Text>
              <Text style={[styles.title, { color: c.foreground }]}>Life happens. What was this?</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close forgotten expense" onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={[styles.intro, { color: c.mutedForeground }]}>Keep it one-time or make it a bill.</Text>

            <View style={[styles.bankCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.bankIcon, { backgroundColor: c.destructive + "16" }]}><Feather name="credit-card" size={19} color={c.destructive} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bankName, { color: c.foreground }]} numberOfLines={2}>{transactionName(transaction)}</Text>
                <Text style={[styles.bankDate, { color: c.mutedForeground }]}>{displayDate(transaction.date)} · Posted by bank</Text>
              </View>
              <Text style={[styles.bankAmount, { color: c.destructive }]}>−{money(transaction.amount)}</Text>
            </View>

            <Text style={[styles.sectionTitle, { color: c.foreground }]}>One-time expense</Text>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Choose its category. It will not repeat.</Text>
            <View style={styles.categoryGrid}>
              {categoryOptions.map(category => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedCategory === category }}
                  key={category}
                  disabled={saving}
                  onPress={() => setSelectedCategory(category)}
                  style={({ pressed }) => [styles.categoryChip, { backgroundColor: selectedCategory === category ? c.primary : c.muted, opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.categoryText, { color: selectedCategory === category ? c.primaryForeground : c.foreground }]}>{category}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Save one-time charge as ${selectedCategory}`} disabled={saving || !selectedCategory} onPress={() => onSaveOneTime(selectedCategory)} style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: saving ? 0.55 : pressed ? 0.82 : 1 }]}>
              <Feather name="check-circle" size={17} color={c.primaryForeground} />
              <Text style={[styles.primaryText, { color: c.primaryForeground }]}>{saving ? "Saving…" : "Save as one-time charge"}</Text>
            </Pressable>

            <View style={[styles.divider, { borderTopColor: c.border }]} />
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Will it happen again?</Text>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Create a bill using this payment.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Create a bill from this bank charge" disabled={saving} onPress={onCreateBill} style={({ pressed }) => [styles.billButton, { borderColor: c.primary + "66", backgroundColor: c.primary + "10", opacity: pressed ? 0.76 : 1 }]}>
              <View style={[styles.billIcon, { backgroundColor: c.primary + "18" }]}><Feather name="file-text" size={17} color={c.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.billTitle, { color: c.foreground }]}>Make this a bill</Text>
                <Text style={[styles.billCopy, { color: c.mutedForeground }]}>Best for recurring charges.</Text>
              </View>
              <Feather name="chevron-right" size={18} color={c.primary} />
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.70)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingTop: 10, maxHeight: "94%" },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 15 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  eyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  title: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  intro: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginBottom: 14 },
  bankCard: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  bankIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bankName: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, bankDate: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 },
  bankAmount: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold", marginTop: 18 },
  sectionCopy: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 3, marginBottom: 10 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  categoryText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  primaryButton: { minHeight: 50, borderRadius: 15, marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  divider: { borderTopWidth: 1, marginTop: 20 },
  billButton: { minHeight: 68, borderWidth: 1, borderRadius: 16, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  billIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  billTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" }, billCopy: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
});

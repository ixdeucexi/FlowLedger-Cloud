import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useBudget, type Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

function displayDate(value?: string): string {
  if (!value) return "Unknown date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function transactionName(transaction: Transaction): string {
  return transaction.merchant_name?.trim() || transaction.note?.trim() || "Transaction";
}

export function RecentlyDeletedTransactions() {
  const c = useColors();
  const { deletedTransactions, restoreDeletedTransaction, canEditHousehold } = useBudget();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (transaction: Transaction) => {
    if (!canEditHousehold || restoringId) return;
    setError(null);
    setRestoringId(transaction.id);
    try {
      await restoreDeletedTransaction(transaction.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "FlowLedger could not restore this transaction.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <View style={styles.section}>
      <View style={[styles.explainer, { backgroundColor: c.primary + "12", borderColor: c.primary + "32" }]}>
        <View style={[styles.explainerIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="rotate-ccw" size={18} color={c.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: c.foreground }]}>Mistakes are reversible</Text>
          <Text style={[styles.description, { color: c.mutedForeground }]}>Deleted transactions stay here and remain separate from your calendar, totals, and Review Center until you restore them.</Text>
        </View>
      </View>

      {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}

      {deletedTransactions.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="check-circle" size={28} color={c.success} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>Nothing deleted</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Transactions you remove will appear here so you can recover them.</Text>
        </View>
      ) : (
        <View style={[styles.list, { backgroundColor: c.card, borderColor: c.border }]}>
          {deletedTransactions.map((transaction, index) => {
            const restoring = restoringId === transaction.id;
            const transfer = Boolean(transaction.transfer_group_id);
            return (
              <View
                key={transaction.id}
                style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}
              >
                <View style={[styles.rowIcon, { backgroundColor: transaction.source === "plaid" ? c.success + "14" : c.primary + "14" }]}>
                  <Feather name={transaction.source === "plaid" ? "credit-card" : "edit-3"} size={17} color={transaction.source === "plaid" ? c.success : c.primary} />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.transactionName, { color: c.foreground }]}>{transactionName(transaction)}</Text>
                  <Text style={[styles.meta, { color: c.mutedForeground }]}>
                    {transfer ? "Transfer" : transaction.source === "plaid" ? "Bank transaction" : "Manual transaction"} · {displayDate(transaction.date)}
                  </Text>
                  <Text style={[styles.deletedDate, { color: c.mutedForeground }]}>Deleted {displayDate(transaction.deleted_at)}</Text>
                </View>
                <View style={styles.actions}>
                  <Text style={[styles.amount, { color: Number(transaction.amount) >= 0 ? c.success : c.destructive }]}>${Math.abs(Number(transaction.amount) || 0).toFixed(2)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${transactionName(transaction)}`}
                    disabled={!canEditHousehold || Boolean(restoringId)}
                    onPress={() => void restore(transaction)}
                    style={({ pressed }) => [
                      styles.restoreButton,
                      { backgroundColor: c.primary, opacity: !canEditHousehold || restoringId ? 0.45 : pressed ? 0.78 : 1 },
                    ]}
                  >
                    <Feather name="rotate-ccw" size={13} color={c.primaryForeground} />
                    <Text style={[styles.restoreText, { color: c.primaryForeground }]}>{restoring ? "Restoring" : "Restore"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {!canEditHousehold ? <Text style={[styles.viewerNote, { color: c.mutedForeground }]}>A household editor can restore deleted transactions.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, marginBottom: 20 },
  explainer: { borderWidth: 1, borderRadius: 18, padding: 15, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  explainerIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", lineHeight: 21 },
  description: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 3 },
  error: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 10 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center", marginTop: 4, maxWidth: 340 },
  list: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  row: { minHeight: 92, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  transactionName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 2 },
  deletedDate: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 15 },
  actions: { alignItems: "flex-end", gap: 7 },
  amount: { fontSize: 14, fontFamily: "Inter_700Bold" },
  restoreButton: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  restoreText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  viewerNote: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
});

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { EmptyState } from "@/components/EmptyState";
import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e", Debt: "#e11d48", Other: "#94a3b8",
};

export default function BillsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, addBill, updateBill, deleteBill } = useBudget();
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [filter, setFilter] = useState<"all" | "debts" | "recurring">("all");

  const filteredBills = bills
    .filter(b => {
      if (filter === "debts") return b.is_debt;
      if (filter === "recurring") return b.is_recurring;
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);
  const totalDebt = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);

  const handleDelete = useCallback((id: string) => {
    const bill = bills.find(b => b.id === id);
    Alert.alert("Delete Bill", `Remove "${bill?.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteBill(id); } },
    ]);
  }, [bills, deleteBill]);

  const handleSave = useCallback((data: Omit<Bill, "id" | "created_at"> | Bill) => {
    if ("id" in data) updateBill(data as Bill);
    else addBill(data);
  }, [addBill, updateBill]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Payment Schedule</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            ${totalAmount.toFixed(0)}/mo · ${totalDebt.toFixed(0)} debt
          </Text>
        </View>
        <Pressable
          onPress={() => { setEditBill(null); setModalVisible(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="plus" size={22} color={c.primaryForeground} />
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(["all", "debts", "recurring"] as const).map(f => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, { backgroundColor: filter === f ? c.primary : c.card, borderRadius: colors.radius }]}
          >
            <Text style={[styles.filterText, { color: filter === f ? c.primaryForeground : c.mutedForeground }]}>
              {f === "all" ? "All" : f === "debts" ? "Debts" : "Recurring"}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filteredBills}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={filteredBills.length > 0}
        ListEmptyComponent={
          <EmptyState icon="file-text" title="No Bills" message="Add your first bill to start tracking." actionLabel="Add Bill" onAction={() => { setEditBill(null); setModalVisible(true); }} />
        }
        renderItem={({ item }) => {
          const catColor = CAT_COLORS[item.category] ?? c.primary;
          return (
            <Pressable
              onPress={() => { setEditBill(item); setModalVisible(true); }}
              style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.catBar, { backgroundColor: catColor }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.billName, { color: c.foreground }]}>{item.name}</Text>
                    <View style={styles.tagRow}>
                      <View style={[styles.tag, { backgroundColor: catColor + "20" }]}>
                        <Text style={[styles.tagText, { color: catColor }]}>{item.category}</Text>
                      </View>
                      {item.is_debt && (
                        <View style={[styles.tag, { backgroundColor: c.destructive + "20" }]}>
                          <Text style={[styles.tagText, { color: c.destructive }]}>Debt</Text>
                        </View>
                      )}
                      {!item.is_recurring && (
                        <View style={[styles.tag, { backgroundColor: c.muted }]}>
                          <Text style={[styles.tagText, { color: c.mutedForeground }]}>One-time</Text>
                        </View>
                      )}
                      <Text style={[styles.tagText, { color: c.mutedForeground, marginLeft: 4 }]}>Due {item.due_day}</Text>
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <Text style={[styles.amount, { color: c.foreground }]}>${item.amount.toFixed(2)}</Text>
                    <Text style={[styles.amountLabel, { color: c.mutedForeground }]}>/mo</Text>
                  </View>
                </View>
                {item.is_debt && item.balance > 0 && (
                  <View style={styles.debtInfo}>
                    <Text style={[styles.debtBalance, { color: c.mutedForeground }]}>Balance: <Text style={[styles.debtBalanceVal, { color: c.destructive }]}>${item.balance.toFixed(2)}</Text></Text>
                    {item.interest_rate > 0 && (
                      <Text style={[styles.debtBalance, { color: c.mutedForeground }]}>{item.interest_rate}% APR</Text>
                    )}
                  </View>
                )}
              </View>
              <Pressable onPress={() => handleDelete(item.id)} hitSlop={8} style={styles.deleteBtn}>
                <Feather name="trash-2" size={15} color={c.destructive} />
              </Pressable>
            </Pressable>
          );
        }}
      />

      <AddBillModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setEditBill(null); }}
        onSave={handleSave}
        editBill={editBill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 16 },
  card: { flexDirection: "row", marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2, overflow: "hidden" },
  catBar: { width: 4 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "flex-start" },
  cardLeft: { flex: 1 },
  cardRight: { alignItems: "flex-end", marginLeft: 8 },
  billName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  tagRow: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amount: { fontSize: 17, fontFamily: "Inter_700Bold" },
  amountLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  debtInfo: { flexDirection: "row", gap: 12, marginTop: 8 },
  debtBalance: { fontSize: 12, fontFamily: "Inter_400Regular" },
  debtBalanceVal: { fontFamily: "Inter_600SemiBold" },
  deleteBtn: { padding: 14, justifyContent: "center" },
});

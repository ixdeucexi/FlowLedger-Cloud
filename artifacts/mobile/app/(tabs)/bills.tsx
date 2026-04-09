import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
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

type Filter = "all" | "recurring" | "one-time";

export default function BillsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, addBill, updateBill, deleteBill, dashboardFilter, setDashboardFilter } = useBudget();
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (dashboardFilter === "debts") { setDashboardFilter(null); }
  }, [dashboardFilter]);

  const nonDebtBills = bills.filter(b => !b.is_debt);

  const filteredBills = nonDebtBills
    .filter(b => {
      if (filter === "recurring") return b.is_recurring;
      if (filter === "one-time") return !b.is_recurring;
      return true;
    })
    .sort((a, b) => a.due_day - b.due_day);

  const totalAmount = nonDebtBills.filter(b => b.is_recurring).reduce((s, b) => s + b.amount, 0);
  const totalCount = nonDebtBills.length;

  const handleSave = useCallback((data: Omit<Bill, "id" | "created_at"> | Bill) => {
    if ("id" in data) updateBill(data as Bill);
    else addBill(data);
  }, [addBill, updateBill]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Bills</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {totalCount} bill{totalCount !== 1 ? "s" : ""} · ${totalAmount.toFixed(0)}/mo recurring
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
        {(["all", "recurring", "one-time"] as Filter[]).map(f => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, { backgroundColor: filter === f ? c.primary : c.card, borderRadius: colors.radius }]}
          >
            <Text style={[styles.filterText, { color: filter === f ? c.primaryForeground : c.mutedForeground }]}>
              {f === "all" ? "All" : f === "recurring" ? "Recurring" : "One-Time"}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filteredBills}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ListEmptyComponent={
          <EmptyState icon="file-text" title="No Bills" message="Tap + to add your first bill." actionLabel="Add Bill" onAction={() => { setEditBill(null); setModalVisible(true); }} />
        }
        renderItem={({ item }) => {
          const catColor = CAT_COLORS[item.category] ?? c.primary;
          return (
            <Pressable
              onPress={() => { setEditBill(item); setModalVisible(true); }}
              style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.88 : 1 }]}
            >
              <View style={[styles.catBar, { backgroundColor: catColor }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.billName, { color: c.foreground }]}>{item.name}</Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.tag, { backgroundColor: catColor + "18" }]}>
                        <Text style={[styles.tagText, { color: catColor }]}>{item.category}</Text>
                      </View>
                      <Text style={[styles.metaText, { color: c.mutedForeground }]}>Due day {item.due_day}</Text>
                      {!item.is_recurring && (
                        <View style={[styles.tag, { backgroundColor: c.muted }]}>
                          <Text style={[styles.tagText, { color: c.mutedForeground }]}>One-time</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <Text style={[styles.amount, { color: c.foreground }]}>${item.amount.toFixed(2)}</Text>
                    <Text style={[styles.amountSub, { color: c.mutedForeground }]}>{item.is_recurring ? "/month" : "one-time"}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.editHint}>
                <Feather name="edit-2" size={13} color={c.mutedForeground} />
              </View>
            </Pressable>
          );
        }}
      />

      <AddBillModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setEditBill(null); }}
        onSave={handleSave}
        onDelete={deleteBill}
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
  filterChip: { paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 16 },
  card: { flexDirection: "row", marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2, overflow: "hidden" },
  catBar: { width: 4 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "flex-start" },
  cardLeft: { flex: 1 },
  cardRight: { alignItems: "flex-end", marginLeft: 8 },
  billName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  metaRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  amountSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  editHint: { padding: 14, justifyContent: "center" },
});

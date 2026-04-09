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

type Filter = "all" | "debts" | "recurring";

export default function BillsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, addBill, updateBill, deleteBill, dashboardFilter, setDashboardFilter } = useBudget();
  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (dashboardFilter === "debts") { setFilter("debts"); setDashboardFilter(null); }
  }, [dashboardFilter]);

  const filteredBills = bills
    .filter(b => {
      if (filter === "debts") return b.is_debt;
      if (filter === "recurring") return b.is_recurring;
      return true;
    })
    .sort((a, b) => {
      if (a.is_debt && !b.is_debt) return -1;
      if (!a.is_debt && b.is_debt) return 1;
      if (a.is_debt && b.is_debt) return a.priority - b.priority;
      return a.due_day - b.due_day;
    });

  const totalAmount = bills.filter(b => b.is_recurring).reduce((s, b) => s + b.amount, 0);
  const totalDebt = bills.filter(b => b.is_debt).reduce((s, b) => s + b.balance, 0);

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
        {(["all", "debts", "recurring"] as Filter[]).map(f => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, { backgroundColor: filter === f ? c.primary : c.card, borderRadius: colors.radius }]}
          >
            <Text style={[styles.filterText, { color: filter === f ? c.primaryForeground : c.mutedForeground }]}>
              {f === "all" ? "All" : f === "debts" ? "Debts Only" : "Recurring"}
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
          const debtPayoffPct = item.is_debt && item.balance > 0
            ? Math.min(((item.amount * 12) / (item.balance + item.amount * 12)) * 100, 100)
            : 0;

          return (
            <Pressable
              onPress={() => { setEditBill(item); setModalVisible(true); }}
              style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.88 : 1 }]}
            >
              <View style={[styles.catBar, { backgroundColor: catColor }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.billName, { color: c.foreground }]}>{item.name}</Text>
                      {item.is_debt && (
                        <View style={[styles.debtBadge, { backgroundColor: c.destructive + "20" }]}>
                          <Feather name="credit-card" size={10} color={c.destructive} />
                          <Text style={[styles.debtBadgeText, { color: c.destructive }]}>DEBT #{item.priority}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.metaRow}>
                      <View style={[styles.tag, { backgroundColor: catColor + "18" }]}>
                        <Text style={[styles.tagText, { color: catColor }]}>{item.category}</Text>
                      </View>
                      <Text style={[styles.metaText, { color: c.mutedForeground }]}>Due day {item.due_day}</Text>
                      {!item.is_recurring && (
                        <Text style={[styles.metaText, { color: c.mutedForeground }]}>One-time</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <Text style={[styles.amount, { color: c.foreground }]}>${item.amount.toFixed(2)}</Text>
                    <Text style={[styles.amountSub, { color: c.mutedForeground }]}>/month</Text>
                  </View>
                </View>

                {item.is_debt && item.balance > 0 && (
                  <View style={styles.debtSection}>
                    <View style={styles.debtRow}>
                      <Text style={[styles.debtInfo, { color: c.mutedForeground }]}>
                        Balance: <Text style={[styles.debtBalance, { color: c.destructive }]}>${item.balance.toFixed(2)}</Text>
                      </Text>
                      {item.interest_rate > 0 && (
                        <Text style={[styles.debtInfo, { color: c.mutedForeground }]}>{item.interest_rate}% APR</Text>
                      )}
                    </View>
                    <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
                      <View style={[styles.progressFill, { width: `${debtPayoffPct}%` as any, backgroundColor: c.primary }]} />
                    </View>
                  </View>
                )}
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
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
  billName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  debtBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  debtBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  metaRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  amountSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  debtSection: { marginTop: 10 },
  debtRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  debtInfo: { fontSize: 12, fontFamily: "Inter_400Regular" },
  debtBalance: { fontFamily: "Inter_600SemiBold" },
  progressBg: { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2 },
  editHint: { padding: 14, justifyContent: "center" },
});

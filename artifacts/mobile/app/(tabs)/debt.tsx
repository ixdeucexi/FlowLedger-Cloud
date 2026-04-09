import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert, FlatList, Platform, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddBillModal } from "@/components/AddBillModal";
import { EmptyState } from "@/components/EmptyState";
import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

type SortMode = "priority" | "balance" | "interest";

export default function DebtScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, addBill, updateBill, deleteBill, settings, updateSettings } = useBudget();

  const [modalVisible, setModalVisible] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("priority");

  const debts = bills
    .filter(b => b.is_debt)
    .sort((a, b) => {
      if (sortMode === "priority") return a.priority - b.priority;
      if (sortMode === "balance") return b.balance - a.balance;
      return b.interest_rate - a.interest_rate;
    });

  const totalDebt = debts.reduce((s, b) => s + b.balance, 0);
  const totalMinPayments = debts.reduce((s, b) => s + b.amount, 0);
  const highestAPR = debts.length ? Math.max(...debts.map(b => b.interest_rate)) : 0;

  const handleSave = (data: Omit<Bill, "id" | "created_at"> | Bill) => {
    if ("id" in data) updateBill(data as Bill);
    else addBill(data);
  };

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const priorityColors = ["#22c55e", "#f0b429", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Debt Tracker</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {debts.length} debt{debts.length !== 1 ? "s" : ""} · ${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })} total
          </Text>
        </View>
        <Pressable
          onPress={() => { setEditBill(null); setModalVisible(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="plus" size={22} color={c.primaryForeground} />
        </Pressable>
      </View>

      {debts.length > 0 && (
        <View style={[styles.statsRow, { marginHorizontal: 16, gap: 10 }]}>
          {[
            { label: "Total Debt", value: `$${totalDebt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: c.destructive, icon: "trending-down" as const },
            { label: "Min/Month", value: `$${totalMinPayments.toFixed(0)}`, color: c.warning, icon: "calendar" as const },
            { label: "Highest APR", value: `${highestAPR}%`, color: c.primary, icon: "percent" as const },
          ].map(s => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              <Feather name={s.icon} size={14} color={s.color} />
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.methodRow, { marginHorizontal: 16, marginTop: 10 }]}>
        <View style={[styles.methodToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
          {(["snowball", "avalanche"] as const).map(m => (
            <Pressable
              key={m}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updateSettings({ paymentMethod: m }); }}
              style={[styles.methodBtn, { backgroundColor: settings.paymentMethod === m ? c.primary : "transparent", borderRadius: 8 }]}
            >
              <Feather name={m === "snowball" ? "trending-down" : "percent"} size={12} color={settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground} />
              <Text style={[styles.methodBtnText, { color: settings.paymentMethod === m ? c.primaryForeground : c.mutedForeground }]}>
                {m === "snowball" ? "Snowball" : "Avalanche"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.sortToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
          {(["priority", "balance", "interest"] as SortMode[]).map(s => (
            <Pressable
              key={s}
              onPress={() => setSortMode(s)}
              style={[styles.sortBtn, { backgroundColor: sortMode === s ? c.card : "transparent", borderRadius: 8 }]}
            >
              <Text style={[styles.sortBtnText, { color: sortMode === s ? c.foreground : c.mutedForeground }]}>
                {s === "priority" ? "#" : s === "balance" ? "$" : "%"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={debts}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ListEmptyComponent={
          <EmptyState
            icon="credit-card"
            title="No Debts Tracked"
            message="Add credit cards, loans, or any debt to track payoff progress and get snowball/avalanche recommendations."
            actionLabel="Add Debt"
            onAction={() => { setEditBill(null); setModalVisible(true); }}
          />
        }
        renderItem={({ item, index }) => {
          const priorityColor = priorityColors[Math.min(item.priority - 1, priorityColors.length - 1)] ?? c.primary;
          const originalBalance = item.balance + item.amount * 12;
          const paidPct = originalBalance > 0 ? Math.min(((originalBalance - item.balance) / originalBalance) * 100, 100) : 0;
          const monthsToPayoff = item.balance > 0 && item.amount > 0
            ? Math.ceil(item.balance / item.amount)
            : 0;

          return (
            <Pressable
              onPress={() => { setEditBill(item); setModalVisible(true); }}
              style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.88 : 1 }]}
            >
              <View style={[styles.priorityStrip, { backgroundColor: priorityColor }]}>
                <Text style={styles.priorityNum}>#{item.priority}</Text>
              </View>

              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={[styles.debtName, { color: c.foreground }]}>{item.name}</Text>
                    <View style={styles.metaRow}>
                      {item.interest_rate > 0 && (
                        <View style={[styles.aprBadge, { backgroundColor: c.destructive + "20" }]}>
                          <Text style={[styles.aprText, { color: c.destructive }]}>{item.interest_rate}% APR</Text>
                        </View>
                      )}
                      <Text style={[styles.metaText, { color: c.mutedForeground }]}>Due day {item.due_day}</Text>
                      {monthsToPayoff > 0 && (
                        <Text style={[styles.metaText, { color: c.mutedForeground }]}>~{monthsToPayoff} mo left</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    <Text style={[styles.balance, { color: c.destructive }]}>${item.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                    <Text style={[styles.minPay, { color: c.mutedForeground }]}>${item.amount}/mo min</Text>
                  </View>
                </View>

                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={[styles.progressLabel, { color: c.mutedForeground }]}>Payoff progress</Text>
                    <Text style={[styles.progressPct, { color: paidPct > 0 ? c.success : c.mutedForeground }]}>{paidPct.toFixed(0)}%</Text>
                  </View>
                  <View style={[styles.progressBg, { backgroundColor: c.muted }]}>
                    <View style={[styles.progressFill, { width: `${paidPct}%` as any, backgroundColor: priorityColor }]} />
                  </View>
                </View>

                {settings.paymentMethod === "snowball" && (
                  <View style={[styles.strategyNote, { backgroundColor: priorityColor + "12" }]}>
                    <Feather name="zap" size={11} color={priorityColor} />
                    <Text style={[styles.strategyText, { color: c.mutedForeground }]}>
                      {item.priority === 1
                        ? "Target first — put all extra here"
                        : `Pay off #${item.priority - 1} first, then cascade here`}
                    </Text>
                  </View>
                )}
                {settings.paymentMethod === "avalanche" && item.interest_rate > 0 && (
                  <View style={[styles.strategyNote, { backgroundColor: c.primary + "12" }]}>
                    <Feather name="trending-up" size={11} color={c.primary} />
                    <Text style={[styles.strategyText, { color: c.mutedForeground }]}>
                      {item.priority === 1
                        ? "Highest interest — target this first"
                        : `Lower APR than priority #${item.priority - 1}`}
                    </Text>
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
        forceDebt
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
  statsRow: { flexDirection: "row" },
  statCard: { flex: 1, alignItems: "center", paddingVertical: 12, gap: 4 },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  methodRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 6 },
  methodToggle: { flex: 1, flexDirection: "row", padding: 4, gap: 4 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9 },
  methodBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sortToggle: { flexDirection: "row", padding: 4, gap: 2 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 9 },
  sortBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  list: { paddingHorizontal: 16, paddingTop: 6 },
  card: { flexDirection: "row", marginBottom: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2, overflow: "hidden" },
  priorityStrip: { width: 32, alignItems: "center", justifyContent: "center" },
  priorityNum: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff", transform: [{ rotate: "-90deg" }] },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  cardLeft: { flex: 1 },
  cardRight: { alignItems: "flex-end" },
  debtName: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
  metaRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  aprBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  aprText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  balance: { fontSize: 20, fontFamily: "Inter_700Bold" },
  minPay: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  progressSection: { marginBottom: 8 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  progressLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressPct: { fontSize: 11, fontFamily: "Inter_700Bold" },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  strategyNote: { flexDirection: "row", alignItems: "center", gap: 6, padding: 7, borderRadius: 6 },
  strategyText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  editHint: { padding: 14, justifyContent: "center" },
});

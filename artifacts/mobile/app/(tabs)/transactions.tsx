import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Platform, Pressable, SectionList, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { EmptyState } from "@/components/EmptyState";
import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

type TypeFilter = "all" | "expense" | "income";

const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e",
  Debt: "#e11d48", Other: "#94a3b8",
};

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

function groupByMonth(txs: Transaction[]): { title: string; data: Transaction[] }[] {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const [y, m] = tx.date.split("-");
    const key = `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export default function TransactionsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { transactions, addTransaction, updateTransaction, deleteTransaction } = useBudget();

  const [modalVisible, setModalVisible] = useState(false);
  const [editTx, setEditTx]             = useState<Transaction | null>(null);
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>("all");
  const [search, setSearch]             = useState("");

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  // ── Filter & sort ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...transactions];

    if (typeFilter === "expense") list = list.filter(t => t.amount < 0);
    if (typeFilter === "income")  list = list.filter(t => t.amount > 0);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.note.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [transactions, typeFilter, search]);

  const sections = useMemo(() => groupByMonth(filtered), [filtered]);

  // ── Summary stats ─────────────────────────────────────────────
  const { totalIn, totalOut, net } = useMemo(() => {
    const totalIn  = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [filtered]);

  const handleSave = (data: Omit<Transaction, "id"> | Transaction) => {
    if ("id" in data) updateTransaction(data as Transaction);
    else addTransaction(data);
  };

  const handleDelete = (id: string) => {
    deleteTransaction(id);
    setModalVisible(false);
    setEditTx(null);
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Transactions</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {transactions.length} total
          </Text>
        </View>
        <Pressable
          onPress={() => { setEditTx(null); setModalVisible(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="plus" size={22} color={c.primaryForeground} />
        </Pressable>
      </View>

      {/* ── Search bar ── */}
      <View style={[styles.searchWrap, { paddingHorizontal: 16, marginBottom: 10 }]}>
        <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="search" size={15} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder="Search by note or category…"
            placeholderTextColor={c.mutedForeground}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={14} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Type filter ── */}
      <View style={[styles.filterRow, { paddingHorizontal: 16, marginBottom: 12 }]}>
        {(["all", "expense", "income"] as TypeFilter[]).map(f => (
          <Pressable
            key={f}
            onPress={() => setTypeFilter(f)}
            style={[
              styles.filterChip,
              {
                backgroundColor: typeFilter === f ? c.primary : c.card,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text style={[styles.filterText, { color: typeFilter === f ? c.primaryForeground : c.mutedForeground }]}>
              {f === "all" ? "All" : f === "expense" ? "Expenses" : "Income"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Summary bar ── */}
      {filtered.length > 0 && (
        <View style={[styles.summaryRow, { marginHorizontal: 16, marginBottom: 14, borderRadius: colors.radius, backgroundColor: c.card }]}>
          {[
            { label: "IN",  value: `+$${totalIn.toFixed(0)}`,  color: c.success },
            { label: "OUT", value: `-$${totalOut.toFixed(0)}`, color: c.destructive },
            { label: "NET", value: `${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(0)}`, color: net >= 0 ? c.success : c.destructive },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={[styles.summaryDivider, { backgroundColor: c.border }]} />}
              <View style={styles.summaryStat}>
                <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* ── Grouped list ── */}
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <EmptyState
            icon="repeat"
            title="No Transactions"
            message={
              search || typeFilter !== "all"
                ? "Nothing matches your filter."
                : "Tap + to log your first transaction."
            }
            actionLabel={search || typeFilter !== "all" ? undefined : "Add Transaction"}
            onAction={search || typeFilter !== "all" ? undefined : () => { setEditTx(null); setModalVisible(true); }}
          />
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={[styles.sectionHeader, { backgroundColor: c.background }]}>
            <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const isLast = index === section.data.length - 1;
          const catColor = CAT_COLORS[item.category] ?? c.primary;
          const isExpense = item.amount < 0;

          return (
            <Pressable
              onPress={() => { setEditTx(item); setModalVisible(true); }}
              style={({ pressed }) => [
                styles.txRow,
                {
                  backgroundColor: c.card,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: isLast ? 8 : 2,
                },
              ]}
            >
              {/* Category dot */}
              <View style={[styles.catDot, { backgroundColor: catColor + "25" }]}>
                <View style={[styles.catDotInner, { backgroundColor: catColor }]} />
              </View>

              {/* Middle — note + category + date */}
              <View style={styles.txMid}>
                <Text style={[styles.txNote, { color: c.foreground }]} numberOfLines={1}>
                  {item.note || item.category}
                </Text>
                <View style={styles.txMeta}>
                  <View style={[styles.catBadge, { backgroundColor: catColor + "18" }]}>
                    <Text style={[styles.catBadgeText, { color: catColor }]}>{item.category}</Text>
                  </View>
                  <Text style={[styles.txDate, { color: c.mutedForeground }]}>
                    {formatDate(item.date)}
                  </Text>
                </View>
              </View>

              {/* Amount */}
              <Text style={[styles.txAmount, { color: isExpense ? c.destructive : c.success }]}>
                {isExpense ? "-" : "+"}${Math.abs(item.amount).toFixed(2)}
              </Text>
            </Pressable>
          );
        }}
      />

      <AddTransactionModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setEditTx(null); }}
        onSave={handleSave}
        onDelete={handleDelete}
        editTx={editTx}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  title:    { fontSize: 24, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  searchWrap:  {},
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },

  filterRow:  { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  summaryRow:     { flexDirection: "row", paddingVertical: 14 },
  summaryStat:    { flex: 1, alignItems: "center", gap: 4 },
  summaryValue:   { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel:   { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4, textTransform: "uppercase" },
  summaryDivider: { width: 1 },

  list:          { paddingHorizontal: 16 },
  sectionHeader: { paddingVertical: 6 },
  sectionTitle:  { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },

  txRow:    { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  catDot:   { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  catDotInner: { width: 10, height: 10, borderRadius: 5 },
  txMid:    { flex: 1 },
  txNote:   { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  txMeta:   { flexDirection: "row", gap: 8, alignItems: "center" },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  catBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  txDate:   { fontSize: 11, fontFamily: "Inter_400Regular" },
  txAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },

});

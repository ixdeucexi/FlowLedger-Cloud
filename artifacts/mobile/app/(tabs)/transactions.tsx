import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal, Platform, Pressable, ScrollView, SectionList,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { EmptyState } from "@/components/EmptyState";
import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivitySource = "transaction" | "bill_payment" | "income" | "extra_payment";
type TypeFilter     = "all" | "expense" | "income";

interface ActivityItem {
  id: string;
  date: string;
  amount: number;
  label: string;
  category: string;
  source: ActivitySource;
  editable: boolean;
  rawTx?: Transaction;
  detail?: string;          // human-readable explanation shown in detail sheet
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];
const MONTH_NAMES_LONG = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const CAT_COLORS: Record<string, string> = {
  Housing: "#0f9b8e", Utilities: "#f0b429", Insurance: "#6366f1",
  Transportation: "#ec4899", Food: "#f97316", Entertainment: "#8b5cf6",
  Health: "#ef4444", Education: "#3b82f6", Savings: "#22c55e",
  Debt: "#e11d48", Income: "#22c55e", Other: "#94a3b8",
};

const SOURCE_META: Record<ActivitySource, {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  description: string;
}> = {
  transaction:   { label: "Manual",   icon: "edit-3",      color: "#6366f1", description: "Manually recorded transaction" },
  bill_payment:  { label: "Bill",     icon: "file-text",   color: "#f0b429", description: "Bill marked as paid in Monthly view" },
  income:        { label: "Income",   icon: "trending-up", color: "#22c55e", description: "Scheduled income occurrence" },
  extra_payment: { label: "Debt Pay", icon: "zap",         color: "#e11d48", description: "Extra debt payment (Snowball / Avalanche)" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

function formatDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES_LONG[m - 1]} ${d}, ${y}`;
}

function groupByMonth(items: ActivityItem[]): { title: string; data: ActivityItem[] }[] {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const [y, m] = item.date.split("-");
    const key = `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TransactionsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    transactions, addTransaction, updateTransaction, deleteTransaction,
    bills, overrides, extraPayments,
    getIncomeOccurrencesInMonth,
  } = useBudget();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTx, setEditTx]                     = useState<Transaction | null>(null);
  const [detailItem, setDetailItem]             = useState<ActivityItem | null>(null);
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>("all");
  const [search, setSearch]                     = useState("");

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  // ── Build unified activity feed ───────────────────────────────────────────
  const allActivity = useMemo((): ActivityItem[] => {
    const items: ActivityItem[] = [];
    const today        = new Date();
    const currentMonth = today.getMonth();
    const currentYear  = today.getFullYear();

    // 1. Manual transactions
    for (const tx of transactions) {
      items.push({
        id:       `tx-${tx.id}`,
        date:     tx.date,
        amount:   tx.amount,
        label:    tx.note || tx.category,
        category: tx.category,
        source:   "transaction",
        editable: true,
        rawTx:    tx,
        detail:   tx.note ? `${tx.note} · ${tx.category}` : tx.category,
      });
    }

    // 2. Bill payments — overrides where paid_amount > 0
    for (const override of overrides) {
      if (override.paid_amount <= 0) continue;
      const bill = bills.find(b => b.id === override.bill_id);
      if (!bill) continue;
      const dueDay      = override.custom_due_day ?? bill.due_day;
      const daysInMonth = new Date(override.year, override.month + 1, 0).getDate();
      const day         = Math.min(dueDay, daysInMonth);
      const date        = `${override.year}-${String(override.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      items.push({
        id:       `bill-${override.id}`,
        date,
        amount:   -override.paid_amount,
        label:    bill.name,
        category: bill.category,
        source:   "bill_payment",
        editable: false,
        detail:   `$${override.paid_amount.toFixed(2)} paid on day ${day} of ${MONTH_NAMES_LONG[override.month]} ${override.year}`,
      });
    }

    // 3. Income occurrences — past 24 months up to today
    for (let i = 24; i >= 0; i--) {
      const totalMonths = currentYear * 12 + currentMonth - i;
      const m = totalMonths % 12;
      const y = Math.floor(totalMonths / 12);
      const occurrences = getIncomeOccurrencesInMonth(m, y);
      for (const { income, days, effectiveAmount } of occurrences) {
        for (const day of days) {
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          if (new Date(date + "T00:00:00") > today) continue;
          items.push({
            id:       `income-${income.id}-${date}`,
            date,
            amount:   effectiveAmount ?? 0,
            label:    income.name,
            category: "Income",
            source:   "income",
            editable: false,
            detail:   `${income.frequency.charAt(0).toUpperCase() + income.frequency.slice(1)} income — $${(effectiveAmount ?? 0).toFixed(2)} on ${formatDateLong(date)}`,
          });
        }
      }
    }

    // 4. Extra debt payments
    for (const ep of extraPayments) {
      const date  = `${ep.year}-${String(ep.month + 1).padStart(2, "0")}-01`;
      const names = ep.allocations.map(a => a.billName).join(", ");
      items.push({
        id:       `extra-${ep.id}`,
        date,
        amount:   -ep.amount,
        label:    names || "Extra Debt Payment",
        category: "Debt",
        source:   "extra_payment",
        editable: false,
        detail:   `$${ep.amount.toFixed(2)} applied to: ${names || "debt accounts"} in ${MONTH_NAMES_LONG[ep.month]} ${ep.year}`,
      });
    }

    return items;
  }, [transactions, overrides, bills, extraPayments, getIncomeOccurrencesInMonth]);

  // ── Filter & sort ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...allActivity];
    if (typeFilter === "expense") list = list.filter(t => t.amount < 0);
    if (typeFilter === "income")  list = list.filter(t => t.amount > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => b.date.localeCompare(a.date));
    return list;
  }, [allActivity, typeFilter, search]);

  const sections = useMemo(() => groupByMonth(filtered), [filtered]);

  // ── Summary stats ─────────────────────────────────────────────────────────
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
    setEditModalVisible(false);
    setEditTx(null);
  };

  const openItem = (item: ActivityItem) => {
    if (item.editable && item.rawTx) {
      setEditTx(item.rawTx);
      setEditModalVisible(true);
    } else {
      setDetailItem(item);
    }
  };

  // ── Detail sheet for auto-generated entries ───────────────────────────────
  const renderDetailSheet = () => {
    if (!detailItem) return null;
    const meta      = SOURCE_META[detailItem.source];
    const isExpense = detailItem.amount < 0;
    const catColor  = CAT_COLORS[detailItem.category] ?? c.primary;

    return (
      <Modal
        visible={!!detailItem}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailItem(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setDetailItem(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.background }]} onPress={() => {}}>
            {/* Handle */}
            <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />

            {/* Icon + title */}
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIconWrap, { backgroundColor: meta.color + "20" }]}>
                <Feather name={meta.icon} size={26} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetName, { color: c.foreground }]} numberOfLines={2}>
                  {detailItem.label}
                </Text>
                <View style={[styles.sourcePill, { backgroundColor: meta.color + "18" }]}>
                  <Text style={[styles.sourcePillText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
            </View>

            {/* Amount hero */}
            <View style={[styles.sheetAmtBox, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              <Text style={[styles.sheetAmt, { color: isExpense ? c.destructive : c.success }]}>
                {isExpense ? "−" : "+"}${Math.abs(detailItem.amount).toFixed(2)}
              </Text>
              <Text style={[styles.sheetAmtLabel, { color: c.mutedForeground }]}>
                {isExpense ? "Expense" : "Income"}
              </Text>
            </View>

            {/* Detail rows */}
            {[
              { icon: "calendar" as const,   label: "Date",        value: formatDateLong(detailItem.date) },
              { icon: "tag"      as const,   label: "Category",    value: detailItem.category },
              { icon: "info"     as const,   label: "Source",      value: meta.description },
              ...(detailItem.detail ? [{ icon: "file-text" as const, label: "Details", value: detailItem.detail }] : []),
            ].map(row => (
              <View key={row.label} style={[styles.sheetRow, { borderBottomColor: c.border }]}>
                <View style={[styles.sheetRowIcon, { backgroundColor: c.muted }]}>
                  <Feather name={row.icon} size={14} color={c.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetRowLabel, { color: c.mutedForeground }]}>{row.label}</Text>
                  <Text style={[styles.sheetRowValue, { color: c.foreground }]}>{row.value}</Text>
                </View>
              </View>
            ))}

            {/* Source note */}
            <View style={[styles.sheetNote, { backgroundColor: c.muted, borderRadius: colors.radius }]}>
              <Feather name="lock" size={13} color={c.mutedForeground} />
              <Text style={[styles.sheetNoteText, { color: c.mutedForeground }]}>
                {detailItem.source === "bill_payment"
                  ? "Edit this entry by adjusting the paid amount in Monthly view."
                  : detailItem.source === "income"
                  ? "Edit this entry by updating your income in More → Income Sources."
                  : "Edit this entry from the Bills → Debt tab."}
              </Text>
            </View>

            <Pressable
              onPress={() => setDetailItem(null)}
              style={({ pressed }) => [styles.sheetClose, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.sheetCloseText, { color: c.primaryForeground }]}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Transactions</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {allActivity.length} entries
          </Text>
        </View>
        <Pressable
          onPress={() => { setEditTx(null); setEditModalVisible(true); }}
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
            placeholder="Search by name or category…"
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
              { backgroundColor: typeFilter === f ? c.primary : c.card, borderRadius: colors.radius },
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
          {([
            { label: "IN",  value: `+$${totalIn.toFixed(0)}`,                                         color: c.success },
            { label: "OUT", value: `-$${totalOut.toFixed(0)}`,                                         color: c.destructive },
            { label: "NET", value: `${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(0)}`,              color: net >= 0 ? c.success : c.destructive },
          ] as const).map((s, i) => (
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
            title="No Activity"
            message={
              search || typeFilter !== "all"
                ? "Nothing matches your filter."
                : "Mark bills paid or add income sources to see your activity here."
            }
            actionLabel={search || typeFilter !== "all" ? undefined : "Add Transaction"}
            onAction={search || typeFilter !== "all" ? undefined : () => { setEditTx(null); setEditModalVisible(true); }}
          />
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={[styles.sectionHeader, { backgroundColor: c.background }]}>
            <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const isLast     = index === section.data.length - 1;
          const isExpense  = item.amount < 0;
          const sourceMeta = SOURCE_META[item.source];
          const catColor   = CAT_COLORS[item.category] ?? c.primary;

          return (
            <Pressable
              onPress={() => openItem(item)}
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
              {/* Source icon */}
              <View style={[styles.sourceIcon, { backgroundColor: sourceMeta.color + "20" }]}>
                <Feather name={sourceMeta.icon} size={15} color={sourceMeta.color} />
              </View>

              {/* Middle */}
              <View style={styles.txMid}>
                <Text style={[styles.txNote, { color: c.foreground }]} numberOfLines={1}>
                  {item.label}
                </Text>
                <View style={styles.txMeta}>
                  <View style={[styles.sourceBadge, { backgroundColor: sourceMeta.color + "18" }]}>
                    <Text style={[styles.sourceBadgeText, { color: sourceMeta.color }]}>
                      {sourceMeta.label}
                    </Text>
                  </View>
                  {item.category !== "Income" && (
                    <View style={[styles.catBadge, { backgroundColor: catColor + "18" }]}>
                      <Text style={[styles.catBadgeText, { color: catColor }]}>{item.category}</Text>
                    </View>
                  )}
                  <Text style={[styles.txDate, { color: c.mutedForeground }]}>
                    {formatDate(item.date)}
                  </Text>
                </View>
              </View>

              {/* Amount + action hint */}
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: isExpense ? c.destructive : c.success }]}>
                  {isExpense ? "−" : "+"}${Math.abs(item.amount).toFixed(2)}
                </Text>
                <Feather
                  name={item.editable ? "edit-2" : "chevron-right"}
                  size={12}
                  color={c.mutedForeground}
                  style={{ marginTop: 3 }}
                />
              </View>
            </Pressable>
          );
        }}
      />

      {/* ── Edit modal (manual transactions) ── */}
      <AddTransactionModal
        visible={editModalVisible}
        onClose={() => { setEditModalVisible(false); setEditTx(null); }}
        onSave={handleSave}
        onDelete={handleDelete}
        editTx={editTx}
      />

      {/* ── Detail sheet (auto-generated entries) ── */}
      {renderDetailSheet()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  title:    { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  searchWrap:  {},
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },

  filterRow:  { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
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

  txRow:          { flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  sourceIcon:     { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  txMid:          { flex: 1 },
  txNote:         { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  txMeta:         { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  sourceBadge:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  sourceBadgeText:{ fontSize: 10, fontFamily: "Inter_700Bold" },
  catBadge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  catBadgeText:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  txDate:         { fontSize: 10, fontFamily: "Inter_400Regular" },
  txRight:        { alignItems: "flex-end" },
  txAmount:       { fontSize: 15, fontFamily: "Inter_700Bold" },

  // Detail bottom sheet
  sheetOverlay:    { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet:           { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12 },
  sheetHandle:     { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 18 },
  sheetHeader:     { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 18 },
  sheetIconWrap:   { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  sheetName:       { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 6, lineHeight: 26 },
  sourcePill:      { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sourcePillText:  { fontSize: 11, fontFamily: "Inter_700Bold" },
  sheetAmtBox:     { alignItems: "center", paddingVertical: 20, marginBottom: 16 },
  sheetAmt:        { fontSize: 40, fontFamily: "Inter_700Bold" },
  sheetAmtLabel:   { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  sheetRow:        { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowIcon:    { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 1 },
  sheetRowLabel:   { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.4 },
  sheetRowValue:   { fontSize: 14, fontFamily: "Inter_400Regular" },
  sheetNote:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, marginTop: 16, marginBottom: 4 },
  sheetNoteText:   { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  sheetClose:      { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 14 },
  sheetCloseText:  { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

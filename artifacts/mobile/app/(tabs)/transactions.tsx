import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal, Platform, Pressable, ScrollView, SectionList,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { EmptyState } from "@/components/EmptyState";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { debtPaymentStatusLabel } from "@/lib/forecastDisplay";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivitySource = "transaction" | "bill_payment" | "income" | "extra_payment";
type TypeFilter     = "all" | "expense" | "income";
type SourceFilter   = "all" | ActivitySource;
type DateFilter     = "all" | "this_month" | "last_month" | "this_year";
type SortOrder      = "asc" | "desc";

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
  return `${MONTH_NAMES_LONG[m - 1]} ${d}, ${y}`;
}

function formatDateLong(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES_LONG[m - 1]} ${d}, ${y}`;
}

function groupByMonth(items: ActivityItem[]): { title: string; data: ActivityItem[] }[] {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const [y, m] = item.date.split("-");
    const key = `${MONTH_NAMES_LONG[parseInt(m, 10) - 1]} ${y}`;
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
    transactions, addTransaction, updateTransaction, deleteTransaction, deleteTransfer,
    bills, overrides, extraPayments,
    getIncomeOccurrencesInMonth,
  } = useBudget();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTx, setEditTx]                     = useState<Transaction | null>(null);
  const [detailItem, setDetailItem]             = useState<ActivityItem | null>(null);
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter]         = useState<SourceFilter>("all");
  const [dateFilter, setDateFilter]             = useState<DateFilter>("all");
  const [categoryFilter, setCategoryFilter]     = useState("all");
  const [sortOrder, setSortOrder]               = useState<SortOrder>("desc");
  const [search, setSearch]                     = useState("");
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  useBackDismiss(!!detailItem, () => setDetailItem(null));
  useBackDismiss(filterModalVisible, () => setFilterModalVisible(false));

  const webTopPad = Platform.OS === "web" ? 4 : 0;
  const listBottomPadding = insets.bottom + (Platform.OS === "web" ? 128 : 118);

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
      const bill = bills.find(b => b.id === override.bill_id);
      if (!bill) continue;
      const extraApplied = extraPayments
        .filter(ep => ep.month === override.month && ep.year === override.year)
        .flatMap(ep => ep.allocations)
        .filter(allocation => allocation.billId === override.bill_id)
        .reduce((sum, allocation) => sum + allocation.payment, 0);
      const regularPaid = Math.max(0, override.paid_amount - extraApplied);
      if (regularPaid <= 0) continue;
      const dueDay      = override.custom_due_day ?? bill.due_day;
      const daysInMonth = new Date(override.year, override.month + 1, 0).getDate();
      const day         = Math.min(dueDay, daysInMonth);
      const date        = override.paid_date ?? `${override.year}-${String(override.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      items.push({
        id:       `bill-${override.id}`,
        date,
        amount:   -regularPaid,
        label:    bill.name,
        category: bill.category,
        source:   "bill_payment",
        editable: false,
        detail:   `${regularPaid.toFixed(2)} paid on ${MONTH_NAMES_LONG[override.month]} ${day}, ${override.year}`,
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
      const date  = ep.payment_date ?? `${ep.year}-${String(ep.month + 1).padStart(2, "0")}-01`;
      const names = ep.allocations.map(a => a.billName).join(", ");
      const funding = (ep.sources ?? []).map(source => source.type === "bill_surplus" ? `${source.billName ?? "bill"} surplus` : "manual safe extra").join(", ");
      const status = debtPaymentStatusLabel(date, (ep.sources ?? []).some(source => source.pendingBalanceApply));
      const statusLabel = status === "scheduled" ? "Scheduled" : "Applied";
      items.push({
        id:       `extra-${ep.id}`,
        date,
        amount:   -ep.amount,
        label:    `${statusLabel}: ${names || "Extra Debt Payment"}`,
        category: "Debt",
        source:   "extra_payment",
        editable: false,
        detail:   `$${ep.amount.toFixed(2)} ${status} ${status === "scheduled" ? "for" : "to"} ${names || "debt accounts"} on ${formatDateLong(date)}${funding ? ` · Funded by ${funding}` : ""}`,
      });
    }

    return items;
  }, [transactions, overrides, bills, extraPayments, getIncomeOccurrencesInMonth]);

  // ── Filter & sort ─────────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () => Array.from(new Set(allActivity.map(t => t.category))).sort((a, b) => a.localeCompare(b)),
    [allActivity]
  );

  const activeFilterCount = [
    typeFilter !== "all",
    sourceFilter !== "all",
    dateFilter !== "all",
    categoryFilter !== "all",
    sortOrder !== "desc",
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0 || search.trim().length > 0;

  const clearFilterSelections = () => {
    setTypeFilter("all");
    setSourceFilter("all");
    setDateFilter("all");
    setCategoryFilter("all");
    setSortOrder("desc");
  };

  const clearFilters = () => {
    clearFilterSelections();
    setSearch("");
  };

  const filtered = useMemo(() => {
    let list = [...allActivity];
    if (typeFilter === "expense") list = list.filter(t => t.amount < 0);
    if (typeFilter === "income")  list = list.filter(t => t.amount > 0);
    if (sourceFilter !== "all") list = list.filter(t => t.source === sourceFilter);
    if (categoryFilter !== "all") list = list.filter(t => t.category === categoryFilter);

    if (dateFilter !== "all") {
      const now = new Date();
      const thisYear = now.getFullYear();
      const thisMonth = now.getMonth() + 1;
      const lastMonthDate = new Date(thisYear, now.getMonth() - 1, 1);
      list = list.filter(t => {
        const [year, month] = t.date.split("-").map(Number);
        if (dateFilter === "this_month") return year === thisYear && month === thisMonth;
        if (dateFilter === "last_month") return year === lastMonthDate.getFullYear() && month === lastMonthDate.getMonth() + 1;
        return year === thisYear;
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        SOURCE_META[t.source].label.toLowerCase().includes(q)
      );
    }
    if (!hasActiveFilters) {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      list = list.filter(t => t.date >= monthStart);
      list.sort((a, b) => {
        const aUpcoming = a.date >= today;
        const bUpcoming = b.date >= today;
        if (aUpcoming && bUpcoming) return a.date.localeCompare(b.date);
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        return b.date.localeCompare(a.date);
      });
    } else {
      list.sort((a, b) => sortOrder === "asc"
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date)
      );
    }
    return list;
  }, [allActivity, typeFilter, sourceFilter, dateFilter, categoryFilter, search, sortOrder, hasActiveFilters]);

  const sections = useMemo(() => groupByMonth(filtered), [filtered]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const { totalIn, totalOut, net } = useMemo(() => {
    const totalIn  = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [filtered]);

  const monthlySummary = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
    const monthItems = allActivity.filter(item => item.date.startsWith(monthPrefix));
    const income = monthItems.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const out = monthItems.filter(item => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const weeks = [1, 8, 15, 22, 29]
      .filter(start => start <= daysInMonth)
      .map(start => {
        const end = Math.min(start + 6, daysInMonth);
        const total = monthItems
          .filter(item => {
            const day = Number(item.date.slice(8, 10));
            return day >= start && day <= end;
          })
          .reduce((sum, item) => sum + item.amount, 0);
        return {
          label: end === start
            ? `${MONTH_NAMES_LONG[month - 1]} ${start}, ${year}`
            : `${MONTH_NAMES_LONG[month - 1]} ${start}, ${year} to ${MONTH_NAMES_LONG[month - 1]} ${end}, ${year}`,
          total,
        };
      });
    return { title: `${MONTH_NAMES_LONG[month - 1]} ${year}`, income, out, net: income - out, weeks };
  }, [allActivity]);

  const currentPeriodLabel = useMemo(() => {
    const now = new Date();
    if (dateFilter === "this_month") return `${MONTH_NAMES_LONG[now.getMonth()]} ${now.getFullYear()}`;
    if (dateFilter === "last_month") {
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${MONTH_NAMES_LONG[last.getMonth()]} ${last.getFullYear()}`;
    }
    if (dateFilter === "this_year") return `${now.getFullYear()}`;
    return "All activity";
  }, [dateFilter]);

  const feedOrderLabel = hasActiveFilters
    ? (sortOrder === "asc" ? "oldest first" : "newest first")
    : "upcoming first";

  const quickChips = [
    { key: "all", label: "All", active: typeFilter === "all" && sourceFilter === "all", onPress: () => { setTypeFilter("all"); setSourceFilter("all"); } },
    { key: "out", label: "Money out", active: typeFilter === "expense" && sourceFilter === "all", onPress: () => { setTypeFilter("expense"); setSourceFilter("all"); } },
    { key: "in", label: "Money in", active: typeFilter === "income" && sourceFilter === "all", onPress: () => { setTypeFilter("income"); setSourceFilter("all"); } },
    { key: "bills", label: "Bills", active: sourceFilter === "bill_payment", onPress: () => { setTypeFilter("all"); setSourceFilter("bill_payment"); } },
    { key: "manual", label: "Manual", active: sourceFilter === "transaction", onPress: () => { setTypeFilter("all"); setSourceFilter("transaction"); } },
    { key: "debt", label: "Debt pay", active: sourceFilter === "extra_payment", onPress: () => { setTypeFilter("all"); setSourceFilter("extra_payment"); } },
  ];

  const handleSave = (data: Omit<Transaction, "id"> | Transaction) => {
    if ("id" in data) return updateTransaction(data as Transaction);
    return addTransaction(data);
  };

  const handleDelete = async (id: string) => {
    await deleteTransaction(id);
    setEditModalVisible(false);
    setEditTx(null);
  };

  const handleDeleteTransfer = async (transferGroupId: string) => {
    await deleteTransfer(transferGroupId);
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

  const renderListHeader = () => (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.title, { color: c.foreground }]}>Activity</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
            {filtered.length} of {allActivity.length} entries · {feedOrderLabel}
          </Text>
        </View>
        <Pressable
          onPress={() => { setEditTx(null); setEditModalVisible(true); }}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="plus" size={22} color={c.primaryForeground} />
        </Pressable>
      </View>

      <View style={[styles.activityHero, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.activityHeroTop}>
          <View>
            <Text style={[styles.activityHeroLabel, { color: c.mutedForeground }]}>{currentPeriodLabel}</Text>
            <Text style={[styles.activityHeroTitle, { color: c.foreground }]}>Activity flow</Text>
          </View>
          <View style={[styles.activityHeroBadge, { backgroundColor: net >= 0 ? c.success + "18" : c.destructive + "18" }]}>
            <Text style={[styles.activityHeroBadgeText, { color: net >= 0 ? c.success : c.destructive }]}>
              {net >= 0 ? "Positive" : "Negative"}
            </Text>
          </View>
        </View>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatValue, { color: net >= 0 ? c.success : c.destructive }]}>
              {net >= 0 ? "+" : "-"}${Math.abs(net).toFixed(0)}
            </Text>
            <Text style={[styles.heroStatLabel, { color: c.mutedForeground }]}>Net</Text>
          </View>
          <View style={[styles.heroDivider, { backgroundColor: c.border }]} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatValue, { color: c.success }]}>+${totalIn.toFixed(0)}</Text>
            <Text style={[styles.heroStatLabel, { color: c.mutedForeground }]}>In</Text>
          </View>
          <View style={[styles.heroDivider, { backgroundColor: c.border }]} />
          <View style={styles.heroStat}>
            <Text style={[styles.heroStatValue, { color: c.destructive }]}>-${totalOut.toFixed(0)}</Text>
            <Text style={[styles.heroStatLabel, { color: c.mutedForeground }]}>Out</Text>
          </View>
        </View>
      </View>

      <View style={[styles.monthlySummaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.monthlySummaryHeader}>
          <View>
            <Text style={[styles.activityHeroLabel, { color: c.mutedForeground }]}>Monthly summary</Text>
            <Text style={[styles.monthlySummaryTitle, { color: c.foreground }]}>{monthlySummary.title}</Text>
          </View>
          <Text style={[styles.monthlySummaryNet, { color: monthlySummary.net >= 0 ? c.success : c.destructive }]}>
            {monthlySummary.net >= 0 ? "+" : "-"}${Math.abs(monthlySummary.net).toFixed(0)}
          </Text>
        </View>
        <View style={styles.monthlySummaryStats}>
          <View
            style={[
              styles.monthlySummaryStat,
              {
                backgroundColor: c.isDark ? "rgba(15,23,42,0.42)" : "rgba(248,250,252,0.96)",
                borderColor: c.isDark ? "rgba(148,163,184,0.10)" : "rgba(15,23,42,0.08)",
              },
            ]}
          >
            <Text style={[styles.monthlySummaryValue, { color: c.success }]}>${monthlySummary.income.toFixed(0)}</Text>
            <Text style={[styles.monthlySummaryLabel, { color: c.mutedForeground }]}>Income</Text>
          </View>
          <View
            style={[
              styles.monthlySummaryStat,
              {
                backgroundColor: c.isDark ? "rgba(15,23,42,0.42)" : "rgba(248,250,252,0.96)",
                borderColor: c.isDark ? "rgba(148,163,184,0.10)" : "rgba(15,23,42,0.08)",
              },
            ]}
          >
            <Text style={[styles.monthlySummaryValue, { color: c.destructive }]}>${monthlySummary.out.toFixed(0)}</Text>
            <Text style={[styles.monthlySummaryLabel, { color: c.mutedForeground }]}>Bills & spending</Text>
          </View>
        </View>
        <View style={[styles.weekRows, { borderTopColor: c.border }]}>
          {monthlySummary.weeks.map(week => (
            <View key={week.label} style={styles.weekRow}>
              <Text style={[styles.weekLabel, { color: c.mutedForeground }]}>{week.label}</Text>
              <Text style={[styles.weekValue, { color: week.total >= 0 ? c.success : c.destructive }]}>
                {week.total >= 0 ? "+" : "-"}${Math.abs(week.total).toFixed(0)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.searchWrap, { marginBottom: 10 }]}>
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
        <Pressable
          accessibilityLabel="Filter activity"
          onPress={() => setFilterModalVisible(true)}
          style={({ pressed }) => [
            styles.filterIconButton,
            {
              backgroundColor: activeFilterCount > 0 ? c.primary : c.card,
              borderColor: activeFilterCount > 0 ? c.primary : c.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="filter" size={20} color={activeFilterCount > 0 ? c.primaryForeground : c.foreground} />
          {activeFilterCount > 0 && (
            <View style={[styles.filterCount, { backgroundColor: c.destructive }]}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickChipRow}
        style={styles.quickChipScroller}
      >
        {quickChips.map(chip => (
          <Pressable
            key={chip.key}
            onPress={chip.onPress}
            style={({ pressed }) => [
              styles.quickChip,
              {
                backgroundColor: chip.active ? c.primary : c.card,
                borderColor: chip.active ? c.primary : c.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text style={[styles.quickChipText, { color: chip.active ? c.primaryForeground : c.foreground }]}>{chip.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="green" />
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
        scrollIndicatorInsets={{ bottom: listBottomPadding }}
        stickySectionHeadersEnabled
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          <EmptyState
            icon="repeat"
            title="No Activity"
            message={
              hasActiveFilters
                ? "Nothing matches your filters."
                : "Mark bills paid or add income sources to see your activity here."
            }
            actionLabel={hasActiveFilters ? "Clear filters" : "Add Activity"}
            onAction={hasActiveFilters ? clearFilters : () => { setEditTx(null); setEditModalVisible(true); }}
          />
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={[styles.sectionHeader, { backgroundColor: c.background }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>{title}</Text>
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
                  marginBottom: isLast ? 10 : 7,
                },
              ]}
            >
              <View style={[styles.rowAccent, { backgroundColor: sourceMeta.color }]} />
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

      {/* ── Filter sheet ── */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <Pressable style={styles.filterOverlay} onPress={() => setFilterModalVisible(false)}>
          <Pressable style={[styles.filterSheet, { backgroundColor: c.background }]} onPress={() => {}}>
            <View style={[styles.filterHandle, { backgroundColor: c.border }]} />
            <View style={styles.filterSheetHeader}>
              <View>
                <Text style={[styles.filterSheetTitle, { color: c.foreground }]}>Filter activity</Text>
                <Text style={[styles.filterSheetSub, { color: c.mutedForeground }]}>Choose any combination</Text>
              </View>
              <Pressable accessibilityLabel="Close filters" onPress={() => setFilterModalVisible(false)} hitSlop={8}>
                <Feather name="x" size={21} color={c.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.filterSheetScroll}>
              <Text style={[styles.filterGroupLabel, { color: c.mutedForeground }]}>AMOUNT</Text>
              <View style={styles.filterOptionGrid}>
                {([
                  { id: "all" as TypeFilter, label: "All amounts" },
                  { id: "expense" as TypeFilter, label: "Expenses" },
                  { id: "income" as TypeFilter, label: "Income" },
                ]).map(option => (
                  <Pressable
                    key={option.id}
                    onPress={() => setTypeFilter(option.id)}
                    style={[styles.filterChip, { backgroundColor: typeFilter === option.id ? c.primary : c.card, borderColor: typeFilter === option.id ? c.primary : c.border }]}
                  >
                    <Text style={[styles.filterText, { color: typeFilter === option.id ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.filterGroupLabel, { color: c.mutedForeground }]}>SOURCE</Text>
              <View style={styles.filterOptionGrid}>
                {([
                  { id: "all" as SourceFilter, label: "All sources" },
                  { id: "transaction" as SourceFilter, label: "Manual" },
                  { id: "bill_payment" as SourceFilter, label: "Bills" },
                  { id: "income" as SourceFilter, label: "Scheduled income" },
                  { id: "extra_payment" as SourceFilter, label: "Debt payments" },
                ]).map(option => (
                  <Pressable
                    key={option.id}
                    onPress={() => setSourceFilter(option.id)}
                    style={[styles.filterChip, { backgroundColor: sourceFilter === option.id ? c.primary : c.card, borderColor: sourceFilter === option.id ? c.primary : c.border }]}
                  >
                    <Text style={[styles.filterText, { color: sourceFilter === option.id ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.filterGroupLabel, { color: c.mutedForeground }]}>DATE</Text>
              <View style={styles.filterOptionGrid}>
                {([
                  { id: "all" as DateFilter, label: "All dates" },
                  { id: "this_month" as DateFilter, label: "This month" },
                  { id: "last_month" as DateFilter, label: "Last month" },
                  { id: "this_year" as DateFilter, label: "This year" },
                ]).map(option => (
                  <Pressable
                    key={option.id}
                    onPress={() => setDateFilter(option.id)}
                    style={[styles.filterChip, { backgroundColor: dateFilter === option.id ? c.primary : c.card, borderColor: dateFilter === option.id ? c.primary : c.border }]}
                  >
                    <Text style={[styles.filterText, { color: dateFilter === option.id ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              {categoryOptions.length > 0 && (
                <>
                  <Text style={[styles.filterGroupLabel, { color: c.mutedForeground }]}>CATEGORY</Text>
                  <View style={styles.filterOptionGrid}>
                    {["all", ...categoryOptions].map(category => (
                      <Pressable
                        key={category}
                        onPress={() => setCategoryFilter(category)}
                        style={[styles.filterChip, { backgroundColor: categoryFilter === category ? c.primary : c.card, borderColor: categoryFilter === category ? c.primary : c.border }]}
                      >
                        <Text style={[styles.filterText, { color: categoryFilter === category ? c.primaryForeground : c.foreground }]}>
                          {category === "all" ? "All categories" : category}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.filterGroupLabel, { color: c.mutedForeground }]}>SORT</Text>
              <View style={styles.filterOptionGrid}>
                {([
                  { id: "desc" as SortOrder, label: "Newest first", icon: "arrow-down" as const },
                  { id: "asc" as SortOrder, label: "Oldest first", icon: "arrow-up" as const },
                ]).map(option => (
                  <Pressable
                    key={option.id}
                    onPress={() => setSortOrder(option.id)}
                    style={[styles.filterChip, { backgroundColor: sortOrder === option.id ? c.primary : c.card, borderColor: sortOrder === option.id ? c.primary : c.border }]}
                  >
                    <Feather name={option.icon} size={13} color={sortOrder === option.id ? c.primaryForeground : c.foreground} />
                    <Text style={[styles.filterText, { color: sortOrder === option.id ? c.primaryForeground : c.foreground }]}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.filterActions}>
              <Pressable onPress={clearFilterSelections} style={[styles.filterActionButton, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.filterActionText, { color: c.mutedForeground }]}>Clear</Text>
              </Pressable>
              <Pressable onPress={() => setFilterModalVisible(false)} style={[styles.filterActionButton, { backgroundColor: c.primary, borderColor: c.primary }]}>
                <Text style={[styles.filterActionText, { color: c.primaryForeground }]}>Show {filtered.length} results</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {/* ── Edit modal (manual transactions) ── */}
      <AddTransactionModal
        visible={editModalVisible}
        onClose={() => { setEditModalVisible(false); setEditTx(null); }}
        onSave={handleSave}
        onDelete={handleDelete}
        onDeleteTransfer={handleDeleteTransfer}
        editTx={editTx}
      />

      {/* ── Detail sheet (auto-generated entries) ── */}
      {renderDetailSheet()}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingBottom: 10 },
  title:    { fontSize: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2, letterSpacing: 0.1 },
  addBtn:   { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", shadowColor: "#2563eb", shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 7 },

  activityHero: { marginHorizontal: 16, marginBottom: 9, borderWidth: 1, borderRadius: 20, padding: 12, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 4 },
  activityHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  activityHeroLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  activityHeroTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3, marginTop: 2 },
  activityHeroBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  activityHeroBadgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  heroStats: { flexDirection: "row", alignItems: "center" },
  heroStat: { flex: 1 },
  heroStatValue: { fontSize: 18, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },
  heroStatLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 2 },
  heroDivider: { width: 1, height: 28, marginHorizontal: 10 },
  monthlySummaryCard: { marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderRadius: 20, padding: 12 },
  monthlySummaryHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  monthlySummaryTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  monthlySummaryNet: { fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5 },
  monthlySummaryStats: { flexDirection: "row", gap: 10, marginBottom: 10 },
  monthlySummaryStat: { flex: 1, borderRadius: 14, backgroundColor: "rgba(15,23,42,0.42)", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9 },
  monthlySummaryValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  monthlySummaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  weekRows: { borderTopWidth: 1, paddingTop: 8, gap: 5 },
  weekRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  weekLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  weekValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },

  searchWrap:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  searchBox:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", padding: 0 },
  filterIconButton: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterCount: { position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  filterCountText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },

  quickChipScroller: { height: 38, marginBottom: 8, flexGrow: 0 },
  quickChipRow: { paddingHorizontal: 16, gap: 7, alignItems: "center", paddingBottom: 2 },
  quickChip: { minHeight: 28, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  quickChipText: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_800ExtraBold" },

  filterOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  filterSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, maxHeight: "88%" },
  filterHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  filterSheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 },
  filterSheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  filterSheetSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  filterSheetScroll: { flexGrow: 0 },
  filterGroupLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7, marginTop: 12, marginBottom: 8 },
  filterOptionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderRadius: 10 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  filterActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  filterActionButton: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  filterActionText: { fontSize: 14, fontFamily: "Inter_700Bold" },

  list:          {},
  sectionHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  sectionTitle:  { fontSize: 12, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.7 },

  txRow:          { flexDirection: "row", alignItems: "center", marginHorizontal: 16, padding: 11, gap: 10, borderWidth: 1, borderColor: "rgba(148,163,184,0.10)", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  rowAccent:      { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  sourceIcon:     { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  txMid:          { flex: 1 },
  txNote:         { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 3 },
  txMeta:         { flexDirection: "row", gap: 5, alignItems: "center", flexWrap: "wrap" },
  sourceBadge:    { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  sourceBadgeText:{ fontSize: 9, fontFamily: "Inter_700Bold" },
  catBadge:       { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  catBadgeText:   { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  txDate:         { fontSize: 9, fontFamily: "Inter_400Regular" },
  txRight:        { alignItems: "flex-end" },
  txAmount:       { fontSize: 14, fontFamily: "Inter_800ExtraBold" },

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

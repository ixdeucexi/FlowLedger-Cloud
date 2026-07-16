import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, SectionList,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { BillSurplusModal } from "@/components/BillSurplusModal";
import { CommandPlusButton } from "@/components/CommandPlusButton";
import { DebtPaymentAppliedModal, type DebtPaymentAppliedDetail } from "@/components/DebtPaymentAppliedModal";
import { EmptyState } from "@/components/EmptyState";
import { FullPaymentPromptModal } from "@/components/FullPaymentPromptModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import colors from "@/constants/colors";
import type { Bill, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { debtPaymentStatusLabel } from "@/lib/forecastDisplay";
import { canMatchExpenseToBill, isCashFlowTransaction, isConfirmedBillMatch, isMatchedPaymentLowerThanPlanned, rankBillMatches, resolveMatchedBillBudget } from "@/lib/billMatching";
import { summarizeActivityMonth } from "@/lib/monthlySummary";
import { isValidDateInMonth } from "@/lib/schedule";
import { buildCurrentMonthReviewQueue, matchedOccurrenceAllocations, occurrenceKey, transactionDisplayName } from "@/lib/reviewCenter";

// ── Types ─────────────────────────────────────────────────────────────────────

type ActivitySource = "transaction" | "bank_transaction" | "bill_payment" | "income" | "extra_payment" | "transfer";
type TypeFilter     = "all" | "expense" | "income";
type SourceFilter   = "all" | ActivitySource;
type DateFilter     = "all" | "this_month" | "last_month" | "this_year";
type SortOrder      = "asc" | "desc";
const MODAL_HANDOFF_DELAY_MS = 350;
type MatchedPaymentPrompt = {
  transaction: Transaction;
  bill: Bill;
  budgeted: number;
  actual: number;
  month: number;
  year: number;
};

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
  pending?: boolean;
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
  bank_transaction: { label: "Bank", icon: "credit-card", color: "#0f9b8e", description: "Imported securely from your connected bank" },
  bill_payment:  { label: "Bill",     icon: "file-text",   color: "#f0b429", description: "Bill marked as paid in Monthly view" },
  income:        { label: "Income",   icon: "trending-up", color: "#22c55e", description: "Scheduled income occurrence" },
  extra_payment: { label: "Debt Pay", icon: "zap",         color: "#e11d48", description: "Extra debt payment (Snowball / Avalanche)" },
  transfer:      { label: "Transfer", icon: "repeat",      color: "#64748b", description: "Reviewed movement between your accounts" },
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

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function nextDebtNameAfterPayment(debts: Bill[], debt: Bill, balanceAfter?: number) {
  if (balanceAfter === undefined || balanceAfter > 0.005) return undefined;
  return debts
    .filter(item => item.is_debt && item.id !== debt.id && Number(item.balance) > 0.005)
    .sort((left, right) => Number(left.balance) - Number(right.balance) || left.name.localeCompare(right.name))[0]?.name;
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
  const router = useRouter();
  const { isFeatureLocked, bypassFeature } = useMembership();
  const {
    transactions, pendingBankTransactions, addTransaction, updateTransaction, deleteTransaction, deleteTransfer,
    bills, incomes, overrides, extraPayments, settings,
    getIncomeOccurrencesInMonth, getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal,
    matchTransactionToBill, unmatchTransactionFromBill, setCustomAmount,
    getExtraPayment, previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment,
  } = useBudget();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTx, setEditTx]                     = useState<Transaction | null>(null);
  const [debtPaymentNotice, setDebtPaymentNotice] = useState<DebtPaymentAppliedDetail | null>(null);
  const [detailItem, setDetailItem]             = useState<ActivityItem | null>(null);
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter]         = useState<SourceFilter>("all");
  const [dateFilter, setDateFilter]             = useState<DateFilter>("all");
  const [categoryFilter, setCategoryFilter]     = useState("all");
  const [sortOrder, setSortOrder]               = useState<SortOrder>("desc");
  const [search, setSearch]                     = useState("");
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [weeklySummaryVisible, setWeeklySummaryVisible] = useState(false);
  const [matchTx, setMatchTx] = useState<Transaction | null>(null);
  const [savingMatch, setSavingMatch] = useState(false);
  const [fullPaymentPrompt, setFullPaymentPrompt] = useState<MatchedPaymentPrompt | null>(null);
  const [queuedFullPaymentPrompt, setQueuedFullPaymentPrompt] = useState<MatchedPaymentPrompt | null>(null);
  const [surplusPrompt, setSurplusPrompt] = useState<MatchedPaymentPrompt | null>(null);
  const [queuedSurplusPrompt, setQueuedSurplusPrompt] = useState<MatchedPaymentPrompt | null>(null);
  const [surplusPaymentDate, setSurplusPaymentDate] = useState(todayIsoDate());
  useBackDismiss(!!detailItem, () => setDetailItem(null));
  useBackDismiss(filterModalVisible, () => setFilterModalVisible(false));
  useBackDismiss(weeklySummaryVisible, () => setWeeklySummaryVisible(false));
  useBackDismiss(!!matchTx, () => setMatchTx(null));

  useEffect(() => {
    if (matchTx || fullPaymentPrompt || !queuedFullPaymentPrompt) return;
    const timer = setTimeout(() => {
      setFullPaymentPrompt(queuedFullPaymentPrompt);
      setQueuedFullPaymentPrompt(null);
    }, MODAL_HANDOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fullPaymentPrompt, matchTx, queuedFullPaymentPrompt]);

  useEffect(() => {
    if (fullPaymentPrompt || surplusPrompt || !queuedSurplusPrompt) return;
    const timer = setTimeout(() => {
      setSurplusPrompt(queuedSurplusPrompt);
      setQueuedSurplusPrompt(null);
    }, MODAL_HANDOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fullPaymentPrompt, queuedSurplusPrompt, surplusPrompt]);

  const webTopPad = Platform.OS === "web" ? 4 : 0;
  const listBottomPadding = insets.bottom + (Platform.OS === "web" ? 128 : 118);

  // ── Build unified activity feed ───────────────────────────────────────────
  const allActivity = useMemo((): ActivityItem[] => {
    const items: ActivityItem[] = [];
    const today        = new Date();
    const currentMonth = today.getMonth();
    const currentYear  = today.getFullYear();
    const confirmedBillMatchKeys = new Set(transactions
      .filter(isConfirmedBillMatch)
      .flatMap(transaction => {
        if (!transaction.linked_bill_id) return [];
        const [year, month] = transaction.date.split("-").map(Number);
        return [`${transaction.linked_bill_id}:${year}:${month - 1}`];
      }));

    // Pending Plaid rows are previews only. They stay outside the authoritative
    // transaction list so forecasts, reports, matching, and totals cannot count them.
    for (const pending of pendingBankTransactions) {
      items.push({
        id: `pending-${pending.plaid_transaction_id}`,
        date: pending.transaction_date,
        amount: pending.amount,
        label: pending.merchant_name || pending.name,
        category: pending.category || "Other",
        source: "bank_transaction",
        editable: false,
        pending: true,
        detail: "Pending at your bank. FlowLedger is showing this as a preview and will not count it until it posts.",
      });
    }

    // 1. Manual and bank transactions. Confirmed matches are presented as
    // the actual bill payment instead of a second, separate expense.
    for (const tx of transactions) {
      const matchedBill = tx.linked_bill_id ? bills.find(bill => bill.id === tx.linked_bill_id) : undefined;
      const confirmedMatch = Boolean(matchedBill && isConfirmedBillMatch(tx));
      const matchedIncome = tx.linked_income_id ? incomes.find(income => income.id === tx.linked_income_id) : undefined;
      const allocationDetail = (tx.review_allocations ?? []).map(allocation => {
        if (allocation.type === "bill" || allocation.type === "income" || allocation.type === "planned_expense") return `${allocation.name ?? allocation.type} $${allocation.amount.toFixed(2)}`;
        if (allocation.type === "extra_principal") return `Extra principal $${allocation.amount.toFixed(2)}`;
        if (allocation.type === "category") return `${allocation.category ?? "Other"} $${allocation.amount.toFixed(2)}`;
        return `Transfer $${allocation.amount.toFixed(2)}`;
      }).join(" · ");
      const source: ActivitySource = confirmedMatch
        ? "bill_payment"
        : matchedIncome ? "income"
        : tx.review_status === "transfer" ? "transfer"
        : tx.source === "plaid" ? "bank_transaction" : "transaction";
      items.push({
        id:       `tx-${tx.id}`,
        date:     tx.date,
        amount:   tx.amount,
        label:    transactionDisplayName(tx, confirmedMatch ? matchedBill!.name : matchedIncome?.name),
        category: confirmedMatch ? matchedBill!.category : matchedIncome ? "Income" : tx.category,
        source,
        editable: true,
        rawTx:    tx,
        detail:   allocationDetail || (tx.note ? `${tx.note} · ${tx.category}` : tx.category),
      });
    }

    // 2. Bill payments — overrides where paid_amount > 0
    for (const override of overrides) {
      const bill = bills.find(b => b.id === override.bill_id);
      if (!bill) continue;
      if (confirmedBillMatchKeys.has(`${override.bill_id}:${override.year}:${override.month}`)) continue;
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

    // 3. Income occurrences — past 24 months plus every occurrence in the current month.
    // Matched deposits replace their planned occurrence instead of being added twice.
    const incomeOccurrenceMatches = matchedOccurrenceAllocations(transactions, "income");
    for (let i = 24; i >= 0; i--) {
      const totalMonths = currentYear * 12 + currentMonth - i;
      const m = totalMonths % 12;
      const y = Math.floor(totalMonths / 12);
      const occurrences = getIncomeOccurrencesInMonth(m, y);
      for (const { income, days, effectiveAmount } of occurrences) {
        for (const day of days) {
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const match = incomeOccurrenceMatches.get(occurrenceKey(income.id, date));
          const remaining = !match ? effectiveAmount : match.settlement === "partial"
            ? Math.max(0, Number(match.plannedAmount ?? effectiveAmount) - Number(match.amount || 0))
            : 0;
          if (remaining <= 0.005) continue;
          items.push({
            id:       `income-${income.id}-${date}`,
            date,
            amount:   remaining,
            label:    income.name,
            category: "Income",
            source:   "income",
            editable: false,
            detail:   `${income.frequency.charAt(0).toUpperCase() + income.frequency.slice(1)} income — $${remaining.toFixed(2)} on ${formatDateLong(date)}`,
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
  }, [transactions, pendingBankTransactions, overrides, bills, incomes, extraPayments, getIncomeOccurrencesInMonth]);

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

  const activityReviewCount = useMemo(
    () => buildCurrentMonthReviewQueue(transactions, todayIsoDate()).length,
    [transactions],
  );
  const pendingActivityCount = pendingBankTransactions.length;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const monthlySummary = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    const summary = summarizeActivityMonth(
      allActivity.map(item => ({
        date: item.date,
        amount: item.amount,
        pending: item.pending,
        excludeFromCashFlow: item.source === "transfer"
          || Boolean(item.rawTx && !isCashFlowTransaction(item.rawTx)),
      })),
      year,
      monthIndex,
    );
    return {
      title: `${MONTH_NAMES_LONG[monthIndex]} ${year}`,
      ...summary,
      weeks: summary.weeks.map(week => ({
        ...week,
        label: week.startDay === week.endDay
          ? `${MONTH_NAMES_LONG[monthIndex]} ${week.startDay}`
          : `${MONTH_NAMES_LONG[monthIndex]} ${week.startDay}–${week.endDay}`,
      })),
    };
  }, [allActivity]);

  const feedOrderLabel = hasActiveFilters
    ? (sortOrder === "asc" ? "oldest first" : "newest first")
    : "upcoming first";

  const quickChips = [
    { key: "all", label: "All", active: typeFilter === "all" && sourceFilter === "all", onPress: () => { setTypeFilter("all"); setSourceFilter("all"); } },
    { key: "out", label: "Money out", active: typeFilter === "expense" && sourceFilter === "all", onPress: () => { setTypeFilter("expense"); setSourceFilter("all"); } },
    { key: "in", label: "Money in", active: typeFilter === "income" && sourceFilter === "all", onPress: () => { setTypeFilter("income"); setSourceFilter("all"); } },
    { key: "bills", label: "Bills", active: sourceFilter === "bill_payment", onPress: () => { setTypeFilter("all"); setSourceFilter("bill_payment"); } },
    { key: "manual", label: "Manual", active: sourceFilter === "transaction", onPress: () => { setTypeFilter("all"); setSourceFilter("transaction"); } },
    { key: "bank", label: "Bank", active: sourceFilter === "bank_transaction", onPress: () => { setTypeFilter("all"); setSourceFilter("bank_transaction"); } },
    { key: "debt", label: "Debt pay", active: sourceFilter === "extra_payment", onPress: () => { setTypeFilter("all"); setSourceFilter("extra_payment"); } },
  ];

  const showTransactionDebtNotice = (tx: Omit<Transaction, "id"> | Transaction) => {
    const linkedDebtId = tx.linked_bill_id ?? tx.debt_applied_bill_id;
    if (!linkedDebtId) return;
    const debt = bills.find(item => item.id === linkedDebtId);
    if (!debt?.is_debt) return;
    const amount = Math.abs(Number(tx.debt_applied_amount ?? tx.amount) || 0);
    if (amount <= 0.005 || Number(tx.amount) > 0) return;
    const scheduled = tx.date > todayIsoDate();
    const balanceBefore = Math.max(0, Number(debt.balance) || 0);
    const balanceAfter = scheduled ? undefined : Math.max(0, balanceBefore - amount);
    setDebtPaymentNotice({
      debtName: debt.name,
      amount,
      paymentDate: tx.date,
      scheduled,
      balanceBefore,
      balanceAfter,
      rolledToDebtName: nextDebtNameAfterPayment(bills, debt, balanceAfter),
    });
  };

  const handleSave = async (data: Omit<Transaction, "id"> | Transaction) => {
    if ("id" in data) await updateTransaction(data as Transaction);
    else await addTransaction(data);
    showTransactionDebtNotice(data);
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

  const billMatchOptions = useMemo(() => {
    if (!matchTx) return [];
    const [year, monthNumber] = matchTx.date.split("-").map(Number);
    const month = monthNumber - 1;
    const candidates = getMonthlyBills(month, year).flatMap(bill => {
      const days = getBillOccurrencesInMonth(bill, month, year);
      if (days.length === 0) return [];
      const monthTotal = getBillMonthlyTotal(bill, month, year);
      const occurrenceBudget = resolveMatchedBillBudget(monthTotal / days.length, bill.amount);
      return [{
        billId: bill.id,
        name: bill.name,
        category: bill.category,
        plannedAmount: occurrenceBudget,
        occurrenceDates: days.map(day => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`),
      }];
    });
    return rankBillMatches({
      date: matchTx.date,
      amount: matchTx.amount,
      description: matchTx.merchant_name || matchTx.note || matchTx.category,
      category: matchTx.category,
    }, candidates);
  }, [matchTx, getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal]);
  const matchedBillForModal = matchTx?.linked_bill_id && isConfirmedBillMatch(matchTx)
    ? bills.find(bill => bill.id === matchTx.linked_bill_id)
    : undefined;
  const matchingBankActivity = matchTx?.source === "plaid";

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt || !settings.debtPayoffEnabled) return null;
    const surplus = Math.max(0, surplusPrompt.budgeted - surplusPrompt.actual);
    const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
    const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id)?.amount ?? 0;
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + surplus);
    const dateValid = isValidDateInMonth(surplusPaymentDate, surplusPrompt.month, surplusPrompt.year);
    const preview = previewDebtSnowball(
      surplusPrompt.month,
      surplusPrompt.year,
      total,
      surplus - previousSource,
      dateValid ? surplusPaymentDate : undefined,
    );
    return {
      preview,
      targetDebt: preview.months[0]?.targetName ?? preview.allocations[0]?.billName,
      dateValid,
      safe: dateValid && preview.selectedExtra + 0.005 >= total,
    };
  }, [getExtraPayment, previewDebtSnowball, settings.debtPayoffEnabled, surplusPaymentDate, surplusPrompt]);
  const surplusMonth = surplusPrompt?.month ?? new Date().getMonth();
  const surplusYear = surplusPrompt?.year ?? new Date().getFullYear();
  const surplusMonthText = String(surplusMonth + 1).padStart(2, "0");
  const surplusMonthLastDay = String(new Date(surplusYear, surplusMonth + 1, 0).getDate()).padStart(2, "0");

  const handleMatchBill = async (billId: string) => {
    if (!matchTx || savingMatch) return;
    const transaction = matchTx;
    const bill = bills.find(item => item.id === billId);
    const option = billMatchOptions.find(item => item.billId === billId);
    const [year, monthNumber] = transaction.date.split("-").map(Number);
    const actual = Math.abs(transaction.amount);
    const nextFullPaymentPrompt = bill && option && isMatchedPaymentLowerThanPlanned(transaction.amount, option.plannedAmount)
      ? { transaction, bill, budgeted: option.plannedAmount, actual, month: monthNumber - 1, year }
      : null;
    setSavingMatch(true);
    try {
      await matchTransactionToBill(transaction.id, billId);
      setQueuedFullPaymentPrompt(nextFullPaymentPrompt);
      setMatchTx(null);
    } catch (error) {
      Alert.alert("Could not match bill", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingMatch(false);
    }
  };

  const confirmMatchedFullPayment = () => {
    if (!fullPaymentPrompt) return;
    setSurplusPaymentDate(fullPaymentPrompt.transaction.date);
    setQueuedSurplusPrompt(fullPaymentPrompt);
    setFullPaymentPrompt(null);
  };

  const saveMatchedBillAtActual = async (prompt: MatchedPaymentPrompt) => {
    await setCustomAmount(
      prompt.bill.id,
      prompt.month,
      prompt.year,
      Math.abs(prompt.actual - prompt.bill.amount) < 0.005 ? undefined : prompt.actual,
    );
  };

  const keepMatchedSurplusAvailable = async () => {
    if (!surplusPrompt) return;
    try {
      await saveMatchedBillAtActual(surplusPrompt);
      if (!settings.debtPayoffEnabled) {
        setSurplusPrompt(null);
        return;
      }
      const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
      const sources = (existing?.sources ?? []).filter(source => !(source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id));
      if ((existing?.sources?.length ?? 0) !== sources.length) {
        const total = sources.reduce((sum, source) => sum + source.amount, 0);
        if (total > 0.005) {
          await applyDebtSnowballPayment(
            previewDebtSnowball(surplusPrompt.month, surplusPrompt.year, total),
            sources,
          );
        } else {
          await removeDebtSnowballPayment(surplusPrompt.month, surplusPrompt.year);
        }
      }
      setSurplusPrompt(null);
    } catch (error) {
      Alert.alert("Could not finish bill", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const addMatchedSurplusToSnowball = async () => {
    if (!surplusPrompt || !surplusSnowballOffer?.safe || !surplusSnowballOffer.preview.allocations.length) return;
    const surplus = surplusPrompt.budgeted - surplusPrompt.actual;
    const existing = getExtraPayment(surplusPrompt.month, surplusPrompt.year);
    const otherSources = (existing?.sources ?? [{ type: "manual" as const, amount: existing?.amount ?? 0 }])
      .filter(source => !(source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id));
    const sources = [
      ...otherSources,
      {
        type: "bill_surplus" as const,
        amount: surplus,
        billId: surplusPrompt.bill.id,
        billName: surplusPrompt.bill.name,
      },
    ].filter(source => source.amount > 0.005);
    try {
      await saveMatchedBillAtActual(surplusPrompt);
      await applyDebtSnowballPayment(surplusSnowballOffer.preview, sources);
      setSurplusPrompt(null);
    } catch (error) {
      Alert.alert("Could not route extra money", error instanceof Error ? error.message : "The matched payment is safe; please try the snowball again.");
    }
  };

  const handleUnmatchBill = async () => {
    if (!matchTx || savingMatch) return;
    setSavingMatch(true);
    try {
      await unmatchTransactionFromBill(matchTx.id);
      setMatchTx(null);
    } catch (error) {
      Alert.alert("Could not undo match", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingMatch(false);
    }
  };

  const openItem = (item: ActivityItem) => {
    if (item.rawTx && canMatchExpenseToBill(item.rawTx)) {
      if (item.rawTx.source === "plaid" && isFeatureLocked("transaction_matching")) {
        Alert.alert(
          "Bill matching is a Pro feature",
          "Free plan preview keeps imported transaction matching locked. This test does not change your real household plan.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Admin bypass",
              onPress: () => {
                bypassFeature("transaction_matching");
                setMatchTx(item.rawTx ?? null);
              },
            },
          ],
        );
        return;
      }
      setMatchTx(item.rawTx);
      return;
    }
    if (item.editable && item.rawTx) {
      setEditTx(item.rawTx);
      setEditModalVisible(true);
    } else {
      setDetailItem(item);
    }
  };

  // ── Detail sheet for auto-generated entries ───────────────────────────────
  const renderWeeklySummarySheet = () => (
    <Modal
      visible={weeklySummaryVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setWeeklySummaryVisible(false)}
    >
      <Pressable style={styles.summaryOverlay} onPress={() => setWeeklySummaryVisible(false)}>
        <Pressable
          style={[styles.summarySheet, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => {}}
        >
          <View style={styles.summarySheetHeader}>
            <View>
              <Text style={[styles.activityHeroLabel, { color: c.mutedForeground }]}>Weekly breakdown</Text>
              <Text style={[styles.summarySheetTitle, { color: c.foreground }]}>{monthlySummary.title}</Text>
            </View>
            <Pressable accessibilityLabel="Close weekly summary" onPress={() => setWeeklySummaryVisible(false)} hitSlop={10}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <View style={[styles.summaryTotalRow, { borderColor: c.border }]}>
            <View>
              <Text style={[styles.summaryTinyLabel, { color: c.mutedForeground }]}>Month net</Text>
              <Text style={[styles.summaryLargeNet, { color: monthlySummary.net >= 0 ? c.success : c.destructive }]}>
                {monthlySummary.net >= 0 ? "+" : "-"}${Math.abs(monthlySummary.net).toFixed(0)}
              </Text>
            </View>
            <View style={styles.summaryTotalRight}>
              <Text style={[styles.summaryMiniValue, { color: c.success }]}>+${monthlySummary.income.toFixed(0)} in</Text>
              <Text style={[styles.summaryMiniValue, { color: c.destructive }]}>-${monthlySummary.out.toFixed(0)} out</Text>
            </View>
          </View>

          <View style={styles.summaryWeekList}>
            {monthlySummary.weeks.map(week => (
              <View key={week.label} style={[styles.summaryWeekCard, { backgroundColor: c.background, borderColor: c.border }]}>
                <View style={styles.summaryWeekMiddle}>
                  <Text style={[styles.summaryWeekLabel, { color: c.foreground }]}>{week.label}</Text>
                </View>
                <Text style={[styles.summaryWeekValue, { color: week.total >= 0 ? c.success : c.destructive }]}>
                  {week.total >= 0 ? "+" : "-"}${Math.abs(week.total).toFixed(0)}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => setWeeklySummaryVisible(false)}
            style={({ pressed }) => [styles.sheetClose, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.sheetCloseText, { color: c.primaryForeground }]}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

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
                  : detailItem.pending
                  ? "This is a bank preview only. It cannot be edited or matched until it posts."
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
            {feedOrderLabel}
          </Text>
        </View>
        {activityReviewCount > 0 || pendingActivityCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${activityReviewCount} item${activityReviewCount === 1 ? "" : "s"} need review and ${pendingActivityCount} transaction${pendingActivityCount === 1 ? "" : "s"} are pending`}
            onPress={() => activityReviewCount > 0
              ? router.push({ pathname: "/(tabs)/more", params: { section: "review" } } as any)
              : Alert.alert("Pending bank activity", "Pending transactions are shown at the top of Activity and are not counted until they post.")}
            style={({ pressed }) => [
              styles.reviewAlertButton,
              {
                borderColor: c.warning + "66",
                backgroundColor: "rgba(245,158,11,0.20)",
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Feather name={activityReviewCount > 0 ? "alert-triangle" : "clock"} size={23} color={c.warning} />
            <View style={[styles.reviewAlertBadge, { backgroundColor: c.destructive }]}>
              <Text style={styles.reviewAlertBadgeText}>{activityReviewCount + pendingActivityCount}</Text>
            </View>
          </Pressable>
        ) : (
          <CommandPlusButton
            onPress={() => { setEditTx(null); setEditModalVisible(true); }}
            accessibilityLabel="Add activity"
          />
        )}
      </View>

      {pendingActivityCount > 0 ? (
        <View style={[styles.pendingNotice, { borderColor: c.warning + "55", backgroundColor: c.warning + "12" }]}>
          <Feather name="clock" size={17} color={c.warning} />
          <View style={styles.pendingNoticeCopy}>
            <Text style={[styles.pendingNoticeTitle, { color: c.foreground }]}>
              {pendingActivityCount} pending bank transaction{pendingActivityCount === 1 ? "" : "s"}
            </Text>
            <Text style={[styles.pendingNoticeBody, { color: c.mutedForeground }]}>Visible below, but not counted until posted.</Text>
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={() => setWeeklySummaryVisible(true)}
        style={({ pressed }) => [
          styles.monthlySummaryCard,
          { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <View style={styles.monthlySummaryHeader}>
          <View>
            <Text style={[styles.activityHeroLabel, { color: c.mutedForeground }]}>Activity snapshot</Text>
            <Text style={[styles.monthlySummaryTitle, { color: c.foreground }]}>{monthlySummary.title}</Text>
          </View>
          <View style={[styles.activityHeroBadge, { backgroundColor: monthlySummary.net >= 0 ? c.success + "18" : c.destructive + "18" }]}>
            <Text style={[styles.activityHeroBadgeText, { color: monthlySummary.net >= 0 ? c.success : c.destructive }]}>
              {monthlySummary.net >= 0 ? "Positive" : "Negative"}
            </Text>
          </View>
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
            <Text style={[styles.monthlySummaryValue, { color: monthlySummary.net >= 0 ? c.success : c.destructive }]}>
              {monthlySummary.net >= 0 ? "+" : "-"}${Math.abs(monthlySummary.net).toFixed(0)}
            </Text>
            <Text style={[styles.monthlySummaryLabel, { color: c.mutedForeground }]}>Net</Text>
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
        <View style={[styles.weekSummaryTrigger, { borderTopColor: c.border }]}>
          <View>
            <Text style={[styles.weekSummaryTitle, { color: c.foreground }]}>Weekly breakdown</Text>
            <Text style={[styles.weekSummarySub, { color: c.mutedForeground }]} numberOfLines={1}>
              See weekly net by date range.
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={c.mutedForeground} />
        </View>
      </Pressable>

      <View style={[styles.searchWrap, { marginBottom: 8 }]}>
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
                  {item.pending ? (
                    <View style={[styles.sourceBadge, { backgroundColor: c.warning + "18" }]}>
                      <Text style={[styles.sourceBadgeText, { color: c.warning }]}>Pending</Text>
                    </View>
                  ) : null}
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
        visible={!!matchTx}
        transparent
        animationType="slide"
        onRequestClose={() => setMatchTx(null)}
      >
        <Pressable style={styles.matchOverlay} onPress={() => setMatchTx(null)}>
          <Pressable style={[styles.matchSheet, { backgroundColor: c.background }]} onPress={() => {}}>
            <View style={[styles.filterHandle, { backgroundColor: c.border }]} />
            <View style={styles.matchHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.matchEyebrow, { color: c.mutedForeground }]}>{matchingBankActivity ? "BANK ACTIVITY" : "MANUAL EXPENSE"}</Text>
                <Text style={[styles.matchTitle, { color: c.foreground }]} numberOfLines={2}>
                  {matchTx?.merchant_name || matchTx?.note || "Imported transaction"}
                </Text>
                <Text style={[styles.matchAmount, { color: c.destructive }]}>−${Math.abs(matchTx?.amount ?? 0).toFixed(2)} · {matchTx ? formatDate(matchTx.date) : ""}</Text>
              </View>
              <Pressable accessibilityLabel="Close bill matching" onPress={() => setMatchTx(null)} hitSlop={10}>
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>

            {matchedBillForModal ? (
              <View style={styles.matchBody}>
                <View style={[styles.matchedCard, { backgroundColor: c.success + "16", borderColor: c.success + "55" }]}>
                  <Feather name="check-circle" size={22} color={c.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.matchRowTitle, { color: c.foreground }]}>Matched to {matchedBillForModal.name}</Text>
                    <Text style={[styles.matchRowMeta, { color: c.mutedForeground }]}>This bank payment replaces the bill’s planned cash-flow event.</Text>
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Undo match to ${matchedBillForModal.name}`} disabled={savingMatch} onPress={() => void handleUnmatchBill()} style={[styles.unmatchButton, { borderColor: c.destructive, opacity: savingMatch ? 0.55 : 1 }]}>
                  <Text style={[styles.unmatchButtonText, { color: c.destructive }]}>{savingMatch ? "Updating…" : "Undo match"}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={[styles.matchIntro, { color: c.mutedForeground }]}>Choose the bill this payment fulfilled. FlowLedger will mark it paid and count the money once.</Text>
                <ScrollView style={styles.matchList} showsVerticalScrollIndicator={false}>
                  {billMatchOptions.length > 0 ? billMatchOptions.map((option, index) => (
                    <Pressable
                      key={option.billId}
                      accessibilityRole="button"
                      accessibilityLabel={`Match transaction to ${option.name}, planned ${option.plannedAmount.toFixed(2)}`}
                      disabled={savingMatch}
                      onPress={() => void handleMatchBill(option.billId)}
                      style={({ pressed }) => [styles.matchRow, { backgroundColor: c.card, borderColor: index === 0 && option.score >= 48 ? c.success + "66" : c.border, opacity: savingMatch ? 0.55 : pressed ? 0.82 : 1 }]}
                    >
                      <View style={[styles.matchIcon, { backgroundColor: (index === 0 && option.score >= 48 ? c.success : c.primary) + "18" }]}>
                        <Feather name="file-text" size={17} color={index === 0 && option.score >= 48 ? c.success : c.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.matchRowHeading}>
                          <Text style={[styles.matchRowTitle, { color: c.foreground }]} numberOfLines={1}>{option.name}</Text>
                          {index === 0 && option.score >= 48 && (
                            <View style={[styles.suggestedBadge, { backgroundColor: c.success + "20" }]}>
                              <Text style={[styles.suggestedBadgeText, { color: c.success }]}>Suggested</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.matchRowMeta, { color: c.mutedForeground }]}>Planned ${option.plannedAmount.toFixed(2)} · {option.daysApart === 0 ? "due same day" : option.daysApart === 1 ? "1 day from due date" : option.daysApart !== null ? `${option.daysApart} days from due date` : option.category}</Text>
                        {option.reasons.length > 0 && <Text style={[styles.matchReason, { color: c.success }]}>{option.reasons.slice(0, 2).join(" · ")}</Text>}
                      </View>
                      <Feather name="chevron-right" size={17} color={c.mutedForeground} />
                    </Pressable>
                  )) : (
                    <View style={[styles.noMatchCard, { backgroundColor: c.card, borderColor: c.border }]}>
                      <Text style={[styles.matchRowTitle, { color: c.foreground }]}>No bills due this month</Text>
                      <Text style={[styles.matchRowMeta, { color: c.mutedForeground }]}>Create the bill first, then return here to match it.</Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={matchingBankActivity ? "Edit imported transaction details" : "Edit manual transaction details"}
              onPress={() => {
                const transaction = matchTx;
                setMatchTx(null);
                if (transaction) {
                  setEditTx(transaction);
                  setEditModalVisible(true);
                }
              }}
              style={[styles.editImportedButton, { backgroundColor: c.muted }]}
            >
              <Feather name="edit-2" size={14} color={c.mutedForeground} />
              <Text style={[styles.editImportedText, { color: c.foreground }]}>{matchingBankActivity ? "Edit imported transaction details" : "Edit manual transaction details"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <FullPaymentPromptModal
        visible={!!fullPaymentPrompt}
        prompt={fullPaymentPrompt ? {
          billName: fullPaymentPrompt.bill.name,
          budgeted: fullPaymentPrompt.budgeted,
          actual: fullPaymentPrompt.actual,
        } : null}
        onClose={() => setFullPaymentPrompt(null)}
        onKeepPartial={() => setFullPaymentPrompt(null)}
        onFullPayment={confirmMatchedFullPayment}
      />

      <BillSurplusModal
        visible={!!surplusPrompt}
        billName={surplusPrompt?.bill.name ?? "Bill"}
        itemType={surplusPrompt?.bill.is_debt ? "debt" : "bill"}
        budgeted={surplusPrompt?.budgeted ?? 0}
        actual={surplusPrompt?.actual ?? 0}
        targetDebt={surplusSnowballOffer?.targetDebt}
        snowballSafe={surplusSnowballOffer?.safe ?? false}
        snowballEnabled={settings.debtPayoffEnabled}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        paymentDate={surplusPaymentDate}
        paymentDateValid={surplusSnowballOffer?.dateValid ?? false}
        paymentDateMin={`${surplusYear}-${surplusMonthText}-01`}
        paymentDateMax={`${surplusYear}-${surplusMonthText}-${surplusMonthLastDay}`}
        onPaymentDateChange={setSurplusPaymentDate}
        onKeep={() => void keepMatchedSurplusAvailable()}
        onSnowball={() => void addMatchedSurplusToSnowball()}
        onClose={() => setSurplusPrompt(null)}
      />

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
              <Text style={[styles.filterGroupLabel, { color: c.mutedForeground, marginTop: 2 }]}>QUICK FILTERS</Text>
              <View style={styles.filterOptionGrid}>
                {quickChips.map(chip => (
                  <Pressable
                    key={chip.key}
                    onPress={chip.onPress}
                    style={({ pressed }) => [
                      styles.filterChip,
                      {
                        backgroundColor: chip.active ? c.primary : c.card,
                        borderColor: chip.active ? c.primary : c.border,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.filterText, { color: chip.active ? c.primaryForeground : c.foreground }]}>{chip.label}</Text>
                  </Pressable>
                ))}
              </View>

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
      <DebtPaymentAppliedModal
        visible={!!debtPaymentNotice}
        detail={debtPaymentNotice}
        onClose={() => setDebtPaymentNotice(null)}
      />

      {/* ── Detail sheet (auto-generated entries) ── */}
      {renderWeeklySummarySheet()}
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
  reviewAlertButton: {
    width: 54,
    height: 54,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#f59e0b",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 10,
  },
  reviewAlertBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#020617",
  },
  reviewAlertBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  pendingNotice: { marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  pendingNoticeCopy: { flex: 1 },
  pendingNoticeTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  pendingNoticeBody: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2 },

  activityHeroLabel: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, textTransform: "uppercase" },
  activityHeroBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  activityHeroBadgeText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  monthlySummaryCard: { marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderRadius: 20, padding: 12 },
  monthlySummaryHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  monthlySummaryTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  monthlySummaryStats: { flexDirection: "row", gap: 10, marginBottom: 10 },
  monthlySummaryStat: { flex: 1, borderRadius: 14, backgroundColor: "rgba(15,23,42,0.42)", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9 },
  monthlySummaryValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  monthlySummaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  weekRows: { borderTopWidth: 1, paddingTop: 8, gap: 5 },
  weekRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  weekLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  weekValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  weekSummaryTrigger: { borderTopWidth: 1, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  weekSummaryTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  weekSummarySub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2, lineHeight: 15 },

  summaryOverlay: { flex: 1, justifyContent: "center", paddingHorizontal: 16, backgroundColor: "rgba(2,6,23,0.72)" },
  summarySheet: { width: "100%", maxWidth: 520, maxHeight: "92%", alignSelf: "center", borderWidth: 1, borderRadius: 24, padding: 16, shadowColor: "#7c3aed", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  summarySheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  summarySheetTitle: { fontSize: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7, marginTop: 3 },
  summaryTotalRow: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  summaryTinyLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8 },
  summaryLargeNet: { fontSize: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8, marginTop: 2 },
  summaryTotalRight: { alignItems: "flex-end", gap: 3 },
  summaryMiniValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  summaryWeekList: { gap: 8 },
  summaryWeekCard: { minHeight: 52, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 12 },
  summaryWeekMiddle: { flex: 1 },
  summaryWeekLabel: { fontSize: 13, fontFamily: "Inter_700Bold", lineHeight: 18 },
  summaryWeekValue: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },

  searchWrap:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  searchBox:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", padding: 0 },
  filterIconButton: { width: 44, height: 44, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterCount: { position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  filterCountText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },

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

  matchOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.62)" },
  matchSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, maxHeight: "88%" },
  matchHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  matchEyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginBottom: 4 },
  matchTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  matchAmount: { fontSize: 13, fontFamily: "Inter_700Bold", marginTop: 5 },
  matchIntro: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18, marginBottom: 12 },
  matchList: { flexGrow: 0, maxHeight: 420 },
  matchBody: { gap: 12 },
  matchRow: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  matchIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  matchRowHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  matchRowTitle: { flexShrink: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  matchRowMeta: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 2 },
  matchReason: { fontSize: 10, fontFamily: "Inter_700Bold", marginTop: 3, textTransform: "capitalize" },
  suggestedBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  suggestedBadgeText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase" },
  matchedCard: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 11 },
  noMatchCard: { borderWidth: 1, borderRadius: 16, padding: 15 },
  unmatchButton: { minHeight: 46, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  unmatchButtonText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  editImportedButton: { minHeight: 46, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12 },
  editImportedText: { fontSize: 13, fontFamily: "Inter_700Bold" },

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

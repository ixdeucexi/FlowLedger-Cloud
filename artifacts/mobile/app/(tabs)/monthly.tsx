import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, BackHandler, FlatList, Keyboard, Modal, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { BillSurplusModal } from "@/components/BillSurplusModal";
import { CalendarView } from "@/components/CalendarView";
import { CommandPlusButton } from "@/components/CommandPlusButton";
import { DebtPaymentAppliedModal, type DebtPaymentAppliedDetail } from "@/components/DebtPaymentAppliedModal";
import { EmptyState } from "@/components/EmptyState";
import { FullPaymentPromptModal } from "@/components/FullPaymentPromptModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { SnowballPreviewModal } from "@/components/SnowballPreviewModal";
import colors from "@/constants/colors";
import type { Bill, BillDateMove, DecisionRecord, IncomeItem, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { confirmedBillMatchId, isCashFlowTransaction, isConfirmedBillMatch } from "@/lib/billMatching";
import { allocationLabel, groupPlannedExpenseAllocations, matchedOccurrenceAllocations, occurrenceKey, reviewSettlementSummary, transactionDisplayName } from "@/lib/reviewCenter";
import { evaluateDecision, scenarioDates } from "@/lib/decisions";
import { buildDayForecastFloPrompt, groupForecastEvents } from "@/lib/forecastDisplay";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import type { SnowballProjectionResult } from "@/lib/snowball";
import { isValidDateInMonth } from "@/lib/schedule";
import { confirmAction } from "@/lib/confirmAction";
import { buildDebtPaymentPlanSummary } from "@/lib/debtPaymentPlan";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly" };

type TabView = "bills" | "calendar";
type DueDayPickerState = { bill: Bill; fromDate: string };
type FullPaymentPromptState = {
  bill: Bill;
  budgeted: number;
  actual: number;
  paidDate: string;
  paidKey: string;
  editValue: string;
};

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatLongDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function isoDateForMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayFromIsoDate(date: string) {
  const day = Number(date.slice(8, 10));
  return Number.isFinite(day) ? day : 1;
}

function money(amount: number, sign: "auto" | "none" = "none") {
  const prefix = sign === "auto" && amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${prefix}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function debtSurplusTransactionImportHash(sourceDebtId: string, month: number, year: number) {
  return `flowledger:debt-surplus:${sourceDebtId}:${year}-${String(month + 1).padStart(2, "0")}`;
}

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PayStatus({ paid, partial }: { paid: boolean; partial: boolean }) {
  const c = useColors();
  if (paid) return <View style={[ps.badge, { backgroundColor: c.success + "25" }]}><Text style={[ps.text, { color: c.success }]}>PAID</Text></View>;
  if (partial) return <View style={[ps.badge, { backgroundColor: c.warning + "25" }]}><Text style={[ps.text, { color: c.warning }]}>PARTIAL</Text></View>;
  return <View style={[ps.badge, { backgroundColor: c.destructive + "20" }]}><Text style={[ps.text, { color: c.destructive }]}>UNPAID</Text></View>;
}
const ps = StyleSheet.create({
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
});

export default function MonthlyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ openDate?: string | string[]; openDateAt?: string | string[] }>();
  const {
    bills, overrides, billDateMoves, transactions, extraPayments, goals, decisions, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
    getCustomDueDay, setCustomDueDay,
    moveBillOccurrence, removeBillOccurrenceMove, getBillDateMoveForOccurrence,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction, addBill, deleteBill, updateIncome, deleteIncome,
    getCashFlow, getMonthlyIncome, getDailyBalances, getIncomeOccurrencesInMonth,
    previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment, finalizeBillPayment, getExtraPayment,
    updateDecision, deleteDecision, deleteGoal,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab] = useState<TabView>("calendar");
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [transactionDefaultDate, setTransactionDefaultDate] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const handledOpenDateRef = useRef<string | null>(null);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});
  const [editingPaid, setEditingPaid] = useState<Record<string, string>>({});
  const editingPaidRef = useRef<Record<string, string>>({});
  const paidSaveInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const openDate = Array.isArray(routeParams.openDate) ? routeParams.openDate[0] : routeParams.openDate;
    const openDateAt = Array.isArray(routeParams.openDateAt) ? routeParams.openDateAt[0] : routeParams.openDateAt;
    const token = `${openDate ?? ""}:${openDateAt ?? ""}`;
    if (!openDate || handledOpenDateRef.current === token || !/^\d{4}-\d{2}-\d{2}$/.test(openDate)) return;
    const [year, monthNumber, day] = openDate.split("-").map(Number);
    const parsed = new Date(year, monthNumber - 1, day, 12);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== monthNumber - 1 || parsed.getDate() !== day) return;
    handledOpenDateRef.current = token;
    setSelectedYear(year);
    setMonth(monthNumber - 1);
    setSelectedDate(openDate);
  }, [routeParams.openDate, routeParams.openDateAt, setSelectedYear]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web" || typeof document === "undefined") return undefined;

      const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!viewport) return undefined;

      const previousContent = viewport.content;
      viewport.content = "width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes, viewport-fit=cover";

      return () => {
        viewport.content = previousContent;
      };
    }, []),
  );
  const paidPromptPendingRef = useRef<Set<string>>(new Set());
  const paidSaveSnapshotRef = useRef<Record<string, { value: string; at: number }>>({});
  const [billFilter, setBillFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [extraPayment, setExtraPayment] = useState("");
  const [snowballResults, setSnowballResults] = useState<{ name: string; payment: number; paidOff: boolean }[]>([]);
  const [showSnowballResults, setShowSnowballResults] = useState(false);
  const [dueDayPicker, setDueDayPicker] = useState<DueDayPickerState | null>(null);
  const dueDayPickerBill = dueDayPicker?.bill ?? null;
  const [savingDueDay, setSavingDueDay] = useState(false);
  const [incomeDatePicker, setIncomeDatePicker] = useState<{ income: IncomeItem; day: number; amount: number } | null>(null);
  const [savingIncomeDate, setSavingIncomeDate] = useState(false);
  const [snowballModalVisible, setSnowballModalVisible] = useState(false);
  const [snowballPreview, setSnowballPreview] = useState<SnowballProjectionResult | null>(null);
  const [fullPaymentPrompt, setFullPaymentPrompt] = useState<FullPaymentPromptState | null>(null);
  const [surplusPrompt, setSurplusPrompt] = useState<{ bill: Bill; budgeted: number; actual: number; paidDate: string; matchAmountToActual?: boolean } | null>(null);
  const [surplusPaymentDate, setSurplusPaymentDate] = useState("");
  const [debtPaymentNotice, setDebtPaymentNotice] = useState<DebtPaymentAppliedDetail | null>(null);
  const [editPlan, setEditPlan] = useState<DecisionRecord | null>(null);
  const [editPlanName, setEditPlanName] = useState("");
  const [editPlanAmount, setEditPlanAmount] = useState("");
  const [editPlanDate, setEditPlanDate] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingPaidKey, setSavingPaidKey] = useState<string | null>(null);
  const [monthSummaryDetail, setMonthSummaryDetail] = useState<{
    title: string;
    value: string;
    details: string[];
    fallback: string;
  } | null>(null);
  const [monthSearchVisible, setMonthSearchVisible] = useState(false);
  const [monthSearchQuery, setMonthSearchQuery] = useState("");

  useBackDismiss(txModalVisible, () => {
    setTxModalVisible(false);
    setEditTx(null);
    setTransactionDefaultDate(undefined);
  });
  useBackDismiss(Boolean(dueDayPicker), () => setDueDayPicker(null));
  useBackDismiss(Boolean(incomeDatePicker), () => setIncomeDatePicker(null));
  useBackDismiss(Boolean(monthSummaryDetail), () => setMonthSummaryDetail(null));
  useBackDismiss(Boolean(debtPaymentNotice), () => setDebtPaymentNotice(null));
  useBackDismiss(Boolean(editPlan), () => setEditPlan(null));
  useBackDismiss(showSnowballResults, () => setShowSnowballResults(false));
  useBackDismiss(monthSearchVisible, () => setMonthSearchVisible(false));

  useEffect(() => {
    if (dashboardFilter === "paid" || dashboardFilter === "unpaid") setDashboardFilter(null);
  }, [dashboardFilter, setDashboardFilter]);

  useEffect(() => {
    editingPaidRef.current = editingPaid;
  }, [editingPaid]);

  const getDebtSurplusCreditForMonth = useCallback((sourceDebtId: string, targetMonth = month, targetYear = selectedYear) => {
    const key = debtSurplusTransactionImportHash(sourceDebtId, targetMonth, targetYear);
    return transactions
      .filter(transaction => transaction.import_hash === key)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount) || 0), 0);
  }, [transactions, month, selectedYear]);

  const getEffectivePaidAmount = useCallback((bill: Bill, targetMonth = month, targetYear = selectedYear) => {
    const directPaid = getPaidAmount(bill.id, targetMonth, targetYear);
    return directPaid + (bill.is_debt ? getDebtSurplusCreditForMonth(bill.id, targetMonth, targetYear) : 0);
  }, [getPaidAmount, getDebtSurplusCreditForMonth, month, selectedYear]);

  const debtSurplusTransactionKey = useCallback((sourceDebtId: string) =>
    debtSurplusTransactionImportHash(sourceDebtId, month, selectedYear),
  [month, selectedYear]);

  const removeDebtSurplusTransaction = useCallback(async (sourceDebtId: string) => {
    const key = debtSurplusTransactionKey(sourceDebtId);
    const existingTx = transactions.find(transaction => transaction.import_hash === key);
    if (existingTx) await deleteTransaction(existingTx.id);
  }, [debtSurplusTransactionKey, deleteTransaction, transactions]);

  const showDebtPaymentNotice = useCallback((debt: Bill, amount: number, paymentDate: string, options?: { scheduled?: boolean; balanceBefore?: number; extraMessage?: string }) => {
    if (!debt.is_debt || amount <= 0.005) return;
    const scheduled = options?.scheduled ?? paymentDate > todayIsoDate();
    const balanceBefore = Math.max(0, Number(options?.balanceBefore ?? debt.balance) || 0);
    const balanceAfter = scheduled ? undefined : Math.max(0, balanceBefore - amount);
    const rolledToDebtName = balanceAfter !== undefined && balanceAfter <= 0.005
      ? bills
        .filter(item => item.is_debt && item.id !== debt.id && Number(item.balance) > 0.005)
        .sort((left, right) => Number(left.balance) - Number(right.balance) || left.name.localeCompare(right.name))[0]?.name
      : undefined;
    setDebtPaymentNotice({
      debtName: debt.name,
      amount,
      paymentDate,
      scheduled,
      balanceBefore,
      balanceAfter,
      rolledToDebtName,
      extraMessage: options?.extraMessage,
    });
  }, [bills]);

  useEffect(() => {
    const closeTopOverlay = () => {
      if (debtPaymentNotice) {
        setDebtPaymentNotice(null);
        return true;
      }
      if (fullPaymentPrompt) {
        paidPromptPendingRef.current.delete(fullPaymentPrompt.paidKey);
        setFullPaymentPrompt(null);
        return true;
      }
      if (surplusPrompt) {
        setSurplusPrompt(null);
        return true;
      }
      if (editPlan) {
        setEditPlan(null);
        return true;
      }
      if (monthSummaryDetail) {
        setMonthSummaryDetail(null);
        return true;
      }
      if (dueDayPickerBill) {
        setDueDayPicker(null);
        return true;
      }
      if (incomeDatePicker) {
        setIncomeDatePicker(null);
        return true;
      }
      if (txModalVisible) {
        setTxModalVisible(false);
        setEditTx(null);
        setTransactionDefaultDate(undefined);
        return true;
      }
      if (snowballModalVisible) {
        setSnowballModalVisible(false);
        return true;
      }
      if (snowballPreview) {
        setSnowballPreview(null);
        return true;
      }
      if (showSnowballResults) {
        setShowSnowballResults(false);
        return true;
      }
      if (selectedDate) {
        setSelectedDate(null);
        return true;
      }
      return false;
    };

    if (Platform.OS !== "web") {
      const subscription = BackHandler.addEventListener("hardwareBackPress", closeTopOverlay);
      return () => subscription.remove();
    }

    if (!selectedDate) return;
    if (typeof window === "undefined") return;
    window.history.pushState({ ...(window.history.state ?? {}), flowledgerMonthlyOverlay: selectedDate }, "", window.location.href);
    const onPopState = () => setSelectedDate(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [debtPaymentNotice, dueDayPickerBill, editPlan, fullPaymentPrompt, incomeDatePicker, monthSummaryDetail, selectedDate, showSnowballResults, snowballModalVisible, snowballPreview, surplusPrompt, txModalVisible]);

  const monthBills = useMemo(() => getMonthlyBills(month, selectedYear), [getMonthlyBills, month, selectedYear]);

  const billsWithData = useMemo(() => {
    return monthBills.map(b => {
      // monthlyAmount = per-occurrence × number of occurrences this month
      // (for monthly bills this equals getAmount; for weekly bills it's ×4-5)
      const monthlyAmount = getBillMonthlyTotal(b, month, selectedYear);
      const perOccurrence = getAmount(b, month, selectedYear);
      const paid = getPaidAmount(b.id, month, selectedYear);
      const effectivePaid = getEffectivePaidAmount(b, month, selectedYear);
      const isPaid = monthlyAmount > 0 && effectivePaid >= monthlyAmount - 0.005;
      const isPartial = effectivePaid > 0 && !isPaid;
      return { bill: b, amount: monthlyAmount, perOccurrence, paid, effectivePaid, isPaid, isPartial };
    })
    .filter(x => {
      if (billFilter === "paid") return x.isPaid;
      if (billFilter === "unpaid") return !x.isPaid;
      return true;
    })
    .sort((a, b) => a.bill.due_day - b.bill.due_day);
  }, [monthBills, getAmount, getPaidAmount, getEffectivePaidAmount, month, selectedYear, billFilter]);

  const billSummary = useMemo(() => summarizeMonthlyBills(
    monthBills,
    bill => getBillMonthlyTotal(bill, month, selectedYear),
    bill => getEffectivePaidAmount(bill, month, selectedYear),
  ), [monthBills, getEffectivePaidAmount, getBillMonthlyTotal, month, selectedYear]);
  const totalDue = billSummary.totalDue;
  const totalPaid = billSummary.totalPaid;

  const txList = useMemo(() => getTransactionsForMonth(month, selectedYear), [getTransactionsForMonth, month, selectedYear]);
  const calendarTransactions = useMemo(() => txList.map(transaction => {
    const reviewedLabel = allocationLabel(transaction);
    const primaryAllocation = transaction.review_allocations?.[0];
    return reviewedLabel ? {
      ...transaction,
      note: reviewedLabel,
      category: transaction.user_edited_at ? transaction.category : primaryAllocation?.category || transaction.category,
    } : transaction;
  }), [txList]);
  const billOccurrenceMatches = useMemo(() => matchedOccurrenceAllocations(txList, "bill"), [txList]);
  const incomeOccurrenceMatches = useMemo(() => matchedOccurrenceAllocations(txList, "income"), [txList]);
  const standaloneTxList = useMemo(() => txList.filter(isCashFlowTransaction), [txList]);
  const dailyBalances = useMemo(() => getDailyBalances(month, selectedYear), [getDailyBalances, month, selectedYear]);
  const incomeOccurrences = useMemo(() => {
    const occurrences = getIncomeOccurrencesInMonth(month, selectedYear);
    const flat: { day: number; name: string; amount: number; frequency: string; incomeId: string; income: IncomeItem }[] = [];
    occurrences.forEach(({ income: inc, days, effectiveAmount }) => {
      days.forEach(day => {
        const date = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const match = incomeOccurrenceMatches.get(occurrenceKey(inc.id, date));
        const remaining = !match ? effectiveAmount : match.settlement === "partial"
          ? Math.max(0, Number(match.plannedAmount ?? effectiveAmount) - Number(match.amount || 0))
          : 0;
        if (remaining > 0.005) flat.push({ day, name: inc.name, amount: remaining, frequency: inc.frequency, incomeId: inc.id, income: inc });
      });
    });
    return flat.sort((a, b) => a.day - b.day);
  }, [getIncomeOccurrencesInMonth, incomeOccurrenceMatches, month, selectedYear]);
  const txIncome = standaloneTxList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = standaloneTxList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const monthSummary = useMemo(() => {
    const first = dailyBalances[0];
    const last = dailyBalances[dailyBalances.length - 1];
    const starting = first ? first.balance - first.net : settings.starting_balance;
    const ending = last?.balance ?? starting;
    const lowestDay = dailyBalances.reduce((low, day) => !low || day.balance < low.balance ? day : low, undefined as typeof dailyBalances[number] | undefined);
    const allEvents = dailyBalances.flatMap(day => (day.events ?? []).map(event => ({ ...event, day: day.day })));
    const scheduledIncome = dailyBalances.reduce((sum, day) => sum + day.scheduledIncome, 0);
    const scheduledBills = dailyBalances.reduce((sum, day) => sum + day.bills, 0);
    const planned = allEvents
      .filter(event => event.sourceType === "decision")
      .reduce((sum, event) => sum + event.amount, 0);
    const debtExtras = allEvents
      .filter(event => event.sourceType === "extra_payment" || event.kind === "debt_payment")
      .reduce((sum, event) => sum + event.amount, 0);
    const detailsFor = (predicate: (event: typeof allEvents[number]) => boolean) =>
      allEvents
        .filter(predicate)
        .sort((a, b) => a.day - b.day || Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 10)
        .map(event => `${MONTH_FULL[month]} ${event.day}: ${event.name || event.kind} ${money(event.amount, "auto")}`);
    return {
      starting,
      ending,
      lowest: lowestDay?.balance ?? ending,
      lowestDay: lowestDay?.day,
      income: scheduledIncome + txIncome,
      bills: scheduledBills,
      transactions: txIncome - txExpense,
      planned,
      debtExtras,
      details: {
        income: [
          ...detailsFor(event => event.sourceType === "income" || event.kind === "scheduled_income"),
          ...standaloneTxList.filter(tx => tx.amount > 0).slice(0, 10).map(tx => `${formatShortDate(tx.date)}: ${tx.note || tx.category} ${money(tx.amount, "auto")}`),
        ],
        bills: detailsFor(event => event.sourceType === "bill" || event.kind === "bill"),
        transactions: standaloneTxList.slice(0, 10).map(tx => `${formatShortDate(tx.date)}: ${tx.note || tx.category} ${money(tx.amount, "auto")}`),
        planned: detailsFor(event => event.sourceType === "decision"),
        debtExtras: detailsFor(event => event.sourceType === "extra_payment" || event.kind === "debt_payment"),
      },
    };
  }, [dailyBalances, month, settings.starting_balance, standaloneTxList, txIncome, txExpense]);

  const monthWatchInsight = useMemo(() => {
    if (!monthSummary.lowestDay || monthSummary.lowest >= settings.safety_floor) return null;
    const eventsBeforeLow = dailyBalances
      .filter(day => day.day <= (monthSummary.lowestDay ?? 0))
      .flatMap(day => (day.events ?? []).map(event => ({ ...event, day: day.day })));
    const biggestOutflows = eventsBeforeLow
      .filter(event => event.amount < -0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 3)
      .map(event => `${event.name || event.kind} ${money(event.amount, "auto")} on ${MONTH_FULL[month]} ${event.day}, ${selectedYear}`);
    const reason = biggestOutflows.length
      ? `${MONTH_FULL[month]} drops to ${money(monthSummary.lowest)} on ${MONTH_FULL[month]} ${monthSummary.lowestDay} after ${biggestOutflows.join(", ")}.`
      : `${MONTH_FULL[month]} drops to ${money(monthSummary.lowest)} on ${MONTH_FULL[month]} ${monthSummary.lowestDay}, below your ${money(settings.safety_floor)} safety floor.`;
    const prompt = `${reason} What should I fix first? Preview safer options like moving a flexible bill, lowering a planned decision, or keeping more cash above my safety floor.`;
    return { reason, prompt };
  }, [dailyBalances, month, monthSummary.lowest, monthSummary.lowestDay, settings.safety_floor]);

  const askFloAboutMonthWatch = useCallback(() => {
    if (!monthWatchInsight) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/(tabs)/flo",
      params: { prompt: monthWatchInsight.prompt },
    } as never);
  }, [monthWatchInsight, router]);

  const showMonthSummaryDetail = useCallback((title: string, value: string, details: string[], fallback: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMonthSummaryDetail({ title, value, details, fallback });
  }, []);

  const selectedDay = selectedDate ? parseInt(selectedDate.split("-")[2]) : null;
  const selectedForecastDay = selectedDay === null ? undefined : dailyBalances.find(item => item.day === selectedDay);
  const selectedForecastGroups = useMemo(
    () => groupForecastEvents(selectedForecastDay?.events ?? []),
    [selectedForecastDay]
  );
  const selectedDebtPayments = useMemo(
    () => selectedForecastGroups.find(group => group.key === "debt")?.events ?? [],
    [selectedForecastGroups],
  );
  const incomeForSelectedDay = useMemo(
    () => selectedDay === null ? [] : incomeOccurrences.filter(item => item.day === selectedDay),
    [incomeOccurrences, selectedDay],
  );

  const scheduledBillsForDay = useMemo(() => {
    if (selectedDay === null) return [];
    const occurrenceDate = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    return monthBills.filter(bill => {
      if (!getBillOccurrencesInMonth(bill, month, selectedYear).includes(selectedDay)) return false;
      const match = billOccurrenceMatches.get(occurrenceKey(bill.id, occurrenceDate));
      return !match || match.settlement === "partial";
    });
  }, [monthBills, billOccurrenceMatches, getBillOccurrencesInMonth, selectedDay, month, selectedYear]);

  const movedInByBillId = useMemo(() => {
    if (!selectedDate) return new Map<string, BillDateMove>();
    return new Map(
      billDateMoves
        .filter(move => move.to_date === selectedDate)
        .map(move => [move.bill_id, move] as const),
    );
  }, [billDateMoves, selectedDate]);

  const goalsForSelectedDay = useMemo(() => {
    if (selectedDay === null) return [];
    const db = dailyBalances.find(d => d.day === selectedDay);
    return db ? db.goalExpenses : [];
  }, [selectedDay, dailyBalances]);

  const plansForSelectedDay = useMemo(() => {
    if (!selectedDate) return [];
    const monthEnd = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(new Date(selectedYear, month + 1, 0).getDate()).padStart(2, "0")}`;
    return decisions
      .filter(decision => decision.status === "planned" || decision.status === "calendar")
      .filter(decision => scenarioDates(decision.scenario, monthEnd).includes(selectedDate))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [decisions, selectedDate, month, selectedYear]);

  const plannedExpenseGroupsForSelectedDay = useMemo(() => {
    if (!selectedDate) return [];
    return groupPlannedExpenseAllocations(txList)
      .filter(group => group.occurrenceDate === selectedDate)
      .map(group => {
        const goal = group.source === "goal" ? goals.find(item => item.id === group.targetId) : undefined;
        const decision = group.source === "decision" ? decisions.find(item => item.id === group.targetId) : undefined;
        const plannedAmount = goal
          ? Math.max(0, Number(goal.target_amount) || 0)
          : decision
            ? Math.abs(Number(decision.scenario.amount) || 0)
            : group.plannedAmount;
        const spentAmount = goal
          ? Math.max(0, Number(goal.current_amount) || 0)
          : decision?.actual_amount !== undefined && decision.actual_amount !== null
            ? Math.max(0, Number(decision.actual_amount) || 0)
            : group.spentAmount;
        const closed = Boolean(goal?.closed_at)
          || decision?.status === "completed"
          || Boolean(group.settlement && group.settlement !== "partial");
        const unusedAmount = Math.max(0, plannedAmount - spentAmount);
        return {
          ...group,
          name: goal?.name || decision?.name || group.name,
          plannedAmount,
          spentAmount,
          closed,
          remainingAmount: closed ? 0 : unusedAmount,
          releasedAmount: closed ? unusedAmount : 0,
        };
      });
  }, [decisions, goals, selectedDate, txList]);

  const displayedGoalsForSelectedDay = useMemo(() => {
    const matchedBucketIds = new Set(plannedExpenseGroupsForSelectedDay
      .filter(group => group.source === "goal")
      .map(group => group.targetId));
    return goalsForSelectedDay.filter(goal => !matchedBucketIds.has(goal.id));
  }, [goalsForSelectedDay, plannedExpenseGroupsForSelectedDay]);

  const isFuture = useMemo(() => {
    const now = new Date();
    return selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && month > now.getMonth());
  }, [month, selectedYear]);

  const cashFlow = useMemo(() => getCashFlow(month, selectedYear), [getCashFlow, month, selectedYear]);
  const monthlyIncome = getMonthlyIncome();

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt || !settings.debtPayoffEnabled) return null;
    const surplus = Math.max(0, surplusPrompt.budgeted - surplusPrompt.actual);
    const existing = getExtraPayment(month, selectedYear);
    const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id)?.amount ?? 0;
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + surplus);
    const validDate = isValidDateInMonth(surplusPaymentDate, month, selectedYear);
    const preview = previewDebtSnowball(month, selectedYear, total, surplus - previousSource, validDate ? surplusPaymentDate : undefined);
    return { preview, total, targetDebt: preview.months[0]?.targetName ?? preview.allocations[0]?.billName, dateValid: validDate, safe: validDate && preview.selectedExtra + 0.005 >= total };
  }, [surplusPrompt, surplusPaymentDate, getExtraPayment, previewDebtSnowball, month, selectedYear, settings.debtPayoffEnabled]);

  const askToTreatPaidAsFullPayment = useCallback((prompt: { bill: Bill; budgeted: number; actual: number; paidDate: string }) => {
    const { bill, budgeted, actual, paidDate } = prompt;
    if (bill.frequency === "weekly" || Math.abs(budgeted - actual) < 0.005) return;
    const currentMonthLabel = `${MONTH_FULL[month]} ${selectedYear}`;
    const showPrompt = () => Alert.alert(
      "Was this the full payment?",
      `${bill.name} was paid at $${actual.toFixed(2)}, which is different from the planned $${budgeted.toFixed(2)}. Should I update ${currentMonthLabel}'s amount to $${actual.toFixed(2)} and mark it paid?`,
      [
        { text: `Keep $${budgeted.toFixed(2)}`, style: "cancel" },
        {
          text: "Yes, update it",
          onPress: async () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await finalizeBillPayment(bill.id, month, selectedYear, actual, paidDate);
              await setCustomAmount(bill.id, month, selectedYear, Math.abs(actual - bill.amount) < 0.005 ? undefined : actual);
            } catch (error) {
              Alert.alert("Could not update amount", error instanceof Error ? error.message : "Please try again.");
            }
          },
        },
      ],
    );
    setTimeout(showPrompt, Platform.OS === "web" ? 0 : 250);
  }, [finalizeBillPayment, month, selectedYear, setCustomAmount]);

  const parsePaidInput = useCallback((value: string) => {
    const normalized = value
      .trim()
      .replace(/[$,\s]/g, "")
      .replace(/^\((.*)\)$/, "-$1");
    return Number.parseFloat(normalized);
  }, []);

  const clearPaidEditForKey = useCallback((key: string) => {
    editingPaidRef.current = { ...editingPaidRef.current };
    delete editingPaidRef.current[key];
    setEditingPaid(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const closeFullPaymentPrompt = useCallback(() => {
    if (fullPaymentPrompt) paidPromptPendingRef.current.delete(fullPaymentPrompt.paidKey);
    setFullPaymentPrompt(null);
  }, [fullPaymentPrompt]);

  const keepPromptAsPartialPayment = useCallback(async () => {
    if (!fullPaymentPrompt) return;
    const { bill, actual, paidDate, paidKey, editValue } = fullPaymentPrompt;
    paidSaveInFlightRef.current.add(paidKey);
    setSavingPaidKey(paidKey);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const directPaidBefore = getPaidAmount(bill.id, month, selectedYear);
      if (bill.is_debt) await removeDebtSurplusTransaction(bill.id);
      await setPaidAmount(bill.id, month, selectedYear, actual);
      if (bill.is_debt) {
        const delta = actual - directPaidBefore;
        if (delta > 0.005) showDebtPaymentNotice(bill, delta, paidDate, { scheduled: false, balanceBefore: bill.balance });
      }
      paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [paidKey]: { value: editValue, at: Date.now() } };
      clearPaidEditForKey(paidKey);
      paidPromptPendingRef.current.delete(paidKey);
      setFullPaymentPrompt(null);
    } catch (error) {
      Alert.alert("Could not save payment", error instanceof Error ? error.message : "Please try again.");
    } finally {
      paidSaveInFlightRef.current.delete(paidKey);
      setSavingPaidKey(current => current === paidKey ? null : current);
    }
  }, [clearPaidEditForKey, fullPaymentPrompt, getPaidAmount, month, removeDebtSurplusTransaction, selectedYear, setPaidAmount, showDebtPaymentNotice]);

  const confirmPromptAsFullPayment = useCallback(() => {
    if (!fullPaymentPrompt) return;
    const { bill, budgeted, actual, paidDate, paidKey, editValue } = fullPaymentPrompt;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSurplusPrompt({ bill, budgeted, actual, paidDate, matchAmountToActual: true });
    setSurplusPaymentDate(paidDate);
    setSelectedDate(null);
    paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [paidKey]: { value: editValue, at: Date.now() } };
    clearPaidEditForKey(paidKey);
    paidPromptPendingRef.current.delete(paidKey);
    setFullPaymentPrompt(null);
  }, [clearPaidEditForKey, fullPaymentPrompt]);

  const handlePaidBlur = useCallback(async (billId: string, key: string, submittedValue?: string) => {
    if (savingPaidKey === key || paidSaveInFlightRef.current.has(key) || paidPromptPendingRef.current.has(key)) return;
    const hasActiveEdit = Object.prototype.hasOwnProperty.call(editingPaidRef.current, key)
      || Object.prototype.hasOwnProperty.call(editingPaid, key);
    const submittedTrimmed = submittedValue?.trim();
    const recentSave = paidSaveSnapshotRef.current[key];
    if (
      !hasActiveEdit
      && (submittedValue === undefined || submittedTrimmed === "")
      && recentSave
      && Date.now() - recentSave.at < 2000
    ) {
      return;
    }
    if (!hasActiveEdit && (submittedValue === undefined || submittedTrimmed === "")) return;
    const candidates = [submittedValue, editingPaidRef.current[key], editingPaid[key]]
      .filter((candidate): candidate is string => candidate !== undefined);
    const val = candidates.find(candidate => candidate.trim().length > 0) ?? candidates[0];
    if (val === undefined) return;
    const trimmed = val.trim();
    const clearPaidEdit = () => clearPaidEditForKey(key);
    paidSaveInFlightRef.current.add(key);
    setSavingPaidKey(key);
    try {
      const bill = bills.find(item => item.id === billId);
      if (trimmed.length === 0) {
        clearPaidEdit();
        if (bill?.is_debt) {
          const key = `flowledger:debt-surplus:${bill.id}:${selectedYear}-${String(month + 1).padStart(2, "0")}`;
          const existingTx = transactions.find(transaction => transaction.import_hash === key);
          if (existingTx) await deleteTransaction(existingTx.id);
        }
        await setPaidAmount(billId, month, selectedYear, 0);
        paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [key]: { value: "", at: Date.now() } };
        return;
      }
      const parsed = parsePaidInput(trimmed);
      if (!Number.isFinite(parsed)) return;
      const budgeted = bill ? getBillMonthlyTotal(bill, month, selectedYear) : 0;
      const day = bill ? Math.min(new Date(selectedYear, month + 1, 0).getDate(), getCustomDueDay(bill.id, month, selectedYear) ?? bill.due_day) : 1;
      const paidDate = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const existing = getExtraPayment(month, selectedYear);
      const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === billId);
      const newSurplus = Math.max(0, budgeted - parsed);

      if (bill && previousSource && newSurplus <= previousSource.amount + 0.005) {
        const directPaidBefore = bill ? getPaidAmount(bill.id, month, selectedYear) : 0;
        const sources = (existing?.sources ?? [])
          .filter(source => !(source.type === "bill_surplus" && source.billId === billId));
        if (newSurplus > 0.005) sources.push({ ...previousSource, amount: newSurplus });
        const total = sources.reduce((sum, source) => sum + source.amount, 0);
        const preview = previewDebtSnowball(month, selectedYear, total);
        if (bill.is_debt) {
          await setPaidAmount(bill.id, month, selectedYear, parsed);
          const delta = parsed - directPaidBefore;
          if (delta > 0.005) showDebtPaymentNotice(bill, delta, paidDate, { scheduled: false, balanceBefore: bill.balance });
        }
        else await finalizeBillPayment(bill.id, month, selectedYear, parsed, paidDate);
        if (total > 0.005) await applyDebtSnowballPayment(preview, sources);
        else await removeDebtSnowballPayment(month, selectedYear);
        paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [key]: { value: trimmed, at: Date.now() } };
        clearPaidEdit();
        askToTreatPaidAsFullPayment({ bill, budgeted, actual: parsed, paidDate });
        return;
      }
      if (bill && parsed >= 0 && parsed < budgeted) {
        Keyboard.dismiss();
        paidPromptPendingRef.current.add(key);
        setFullPaymentPrompt({ bill, budgeted, actual: parsed, paidDate, paidKey: key, editValue: trimmed });
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (bill && !bill.is_debt) await finalizeBillPayment(billId, month, selectedYear, parsed, paidDate);
      else {
        const directPaidBefore = bill ? getPaidAmount(bill.id, month, selectedYear) : 0;
        await setPaidAmount(billId, month, selectedYear, parsed);
        if (bill?.is_debt) {
          const delta = parsed - directPaidBefore;
          if (delta > 0.005) showDebtPaymentNotice(bill, delta, paidDate, { scheduled: false, balanceBefore: bill.balance });
        }
      }
      paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [key]: { value: trimmed, at: Date.now() } };
      clearPaidEdit();
      if (bill) askToTreatPaidAsFullPayment({ bill, budgeted, actual: parsed, paidDate });
    } finally {
      paidSaveInFlightRef.current.delete(key);
      setSavingPaidKey(current => current === key ? null : current);
    }
  }, [clearPaidEditForKey, editingPaid, savingPaidKey, setPaidAmount, bills, overrides, transactions, deleteTransaction, getBillMonthlyTotal, getCustomDueDay, getPaidAmount, getExtraPayment, previewDebtSnowball, finalizeBillPayment, applyDebtSnowballPayment, removeDebtSnowballPayment, showDebtPaymentNotice, askToTreatPaidAsFullPayment, parsePaidInput, month, selectedYear]);

  const finalizeBillAtActualForMonth = useCallback(async (prompt: { bill: Bill; actual: number; paidDate: string }) => {
    if (prompt.bill.is_debt) {
      await setPaidAmount(prompt.bill.id, month, selectedYear, prompt.actual);
      await finalizeBillPayment(prompt.bill.id, month, selectedYear, prompt.actual, prompt.paidDate);
      return;
    }
    await finalizeBillPayment(prompt.bill.id, month, selectedYear, prompt.actual, prompt.paidDate);
  }, [finalizeBillPayment, month, selectedYear, setPaidAmount]);

  const upsertDebtSurplusTransaction = useCallback(async (
    sourceDebt: Bill,
    targetDebt: { billId: string; billName: string },
    amount: number,
    paymentDate: string,
  ) => {
    const key = debtSurplusTransactionKey(sourceDebt.id);
    const existingTx = transactions.find(transaction => transaction.import_hash === key);
    const nextTx = {
      date: paymentDate,
      amount: -Math.abs(amount),
      category: "Debt",
      note: `${targetDebt.billName} snowball`,
      linked_bill_id: targetDebt.billId,
      debt_applied_amount: 0,
      debt_applied_bill_id: undefined,
      import_hash: key,
      account_id: existingTx?.account_id,
      transfer_group_id: existingTx?.transfer_group_id,
    };
    if (existingTx) await updateTransaction({ ...existingTx, ...nextTx });
    else await addTransaction(nextTx);
  }, [addTransaction, debtSurplusTransactionKey, transactions, updateTransaction]);

  const matchSurplusAmountToActual = useCallback(async (prompt: { bill: Bill; actual: number; matchAmountToActual?: boolean } | null) => {
    if (!prompt?.matchAmountToActual || prompt.bill.frequency === "weekly") return;
    await setCustomAmount(
      prompt.bill.id,
      month,
      selectedYear,
      Math.abs(prompt.actual - prompt.bill.amount) < 0.005 ? undefined : prompt.actual,
    );
  }, [month, selectedYear, setCustomAmount]);

  const keepBillSurplus = async () => {
    if (!surplusPrompt) return;
    if (!settings.debtPayoffEnabled) {
      await finalizeBillAtActualForMonth(surplusPrompt);
      await matchSurplusAmountToActual(surplusPrompt);
      setSurplusPrompt(null);
      return;
    }
    if (surplusPrompt.bill.is_debt) {
      const directPaidBefore = getPaidAmount(surplusPrompt.bill.id, month, selectedYear);
      await finalizeBillAtActualForMonth(surplusPrompt);
      await removeDebtSurplusTransaction(surplusPrompt.bill.id);
      const delta = surplusPrompt.actual - directPaidBefore;
      if (delta > 0.005) {
        showDebtPaymentNotice(surplusPrompt.bill, delta, surplusPrompt.paidDate, {
          scheduled: false,
          balanceBefore: surplusPrompt.bill.balance,
        });
      }
      await matchSurplusAmountToActual(surplusPrompt);
      setSurplusPrompt(null);
      return;
    }
    const existing = getExtraPayment(month, selectedYear);
    const sources = (existing?.sources ?? []).filter(source => !(source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id));
    const total = sources.reduce((sum, source) => sum + source.amount, 0);
    const preview = previewDebtSnowball(month, selectedYear, total);
    await finalizeBillAtActualForMonth(surplusPrompt);
    if ((existing?.sources?.length ?? 0) !== sources.length) {
      if (total > 0.005) await applyDebtSnowballPayment(preview, sources);
      else await removeDebtSnowballPayment(month, selectedYear);
    }
    await matchSurplusAmountToActual(surplusPrompt);
    setSurplusPrompt(null);
  };

  const askToMatchBillAmountToPaid = (prompt: { bill: Bill; budgeted: number; actual: number }) => {
    const { bill, budgeted, actual } = prompt;
    if (bill.is_debt || bill.frequency === "weekly" || Math.abs(budgeted - actual) < 0.005) return;
    const currentMonthLabel = `${MONTH_FULL[month]} ${selectedYear}`;
    const showPrompt = () => Alert.alert(
      "Update bill amount?",
      `${bill.name} was paid at $${actual.toFixed(2)}. Update ${currentMonthLabel}'s bill amount to $${actual.toFixed(2)} so it shows paid with $0 left?`,
      [
        { text: `Keep $${budgeted.toFixed(2)}`, style: "cancel" },
        {
          text: `Update to $${actual.toFixed(2)}`,
          onPress: async () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await setCustomAmount(bill.id, month, selectedYear, Math.abs(actual - bill.amount) < 0.005 ? undefined : actual);
            } catch (error) {
              Alert.alert("Couldn’t update amount", error instanceof Error ? error.message : "Please try again.");
            }
          },
        },
      ],
    );
    setTimeout(showPrompt, Platform.OS === "web" ? 0 : 250);
  };

  const addBillSurplusToSnowball = async () => {
    if (!surplusPrompt || !surplusSnowballOffer) return;
    const surplus = surplusPrompt.budgeted - surplusPrompt.actual;
    if (surplusPrompt.bill.is_debt) {
      const target = surplusSnowballOffer.preview.allocations[0];
      if (!surplusSnowballOffer.safe || !target) return;
      const directPaidBefore = getPaidAmount(surplusPrompt.bill.id, month, selectedYear);
      await finalizeBillAtActualForMonth(surplusPrompt);
      try {
        await upsertDebtSurplusTransaction(
          surplusPrompt.bill,
          { billId: target.billId, billName: target.billName },
          surplus,
          surplusPaymentDate,
        );
      } catch {
        Alert.alert(
          "Debt Finalized",
          "The debt payment was saved, but the leftover could not be added as a snowball transaction. The difference is still available, so you can try again.",
        );
      }
      const delta = surplusPrompt.actual - directPaidBefore;
      if (delta > 0.005) {
        showDebtPaymentNotice(surplusPrompt.bill, delta, surplusPrompt.paidDate, {
          scheduled: false,
          balanceBefore: surplusPrompt.bill.balance,
          extraMessage: `I also added $${surplus.toFixed(2)} to ${target.billName} for ${formatShortDate(surplusPaymentDate)}.`,
        });
      }
      await matchSurplusAmountToActual(surplusPrompt);
      setSurplusPrompt(null);
      return;
    }
    const existing = getExtraPayment(month, selectedYear);
    const otherSources = (existing?.sources ?? [{ type: "manual" as const, amount: existing?.amount ?? 0 }])
      .filter(source => !(source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id));
    const sources = [...otherSources, { type: "bill_surplus" as const, amount: surplus, billId: surplusPrompt.bill.id, billName: surplusPrompt.bill.name }]
      .filter(source => source.amount > 0.005);
    if (!surplusSnowballOffer.safe || !surplusSnowballOffer.preview.allocations.length) return;
    await finalizeBillAtActualForMonth(surplusPrompt);
    try {
      await applyDebtSnowballPayment(surplusSnowballOffer.preview, sources);
    } catch {
      Alert.alert(
        "Bill Finalized",
        "The actual bill amount was saved, but the surplus could not be added to debt. The difference is still available in your account, so you can safely try again.",
      );
    }
    await matchSurplusAmountToActual(surplusPrompt);
    setSurplusPrompt(null);
  };

  const handleAmtBlur = useCallback((bill: { id: string; amount: number }, key: string) => {
    const val = editingAmounts[key];
    if (val === undefined) return;
    const parsed = parseFloat(val);
    setCustomAmount(bill.id, month, selectedYear, isNaN(parsed) || parsed === bill.amount ? undefined : parsed);
    setEditingAmounts(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingAmounts, setCustomAmount, month, selectedYear]);

  const saveDueDayChange = useCallback(async (picker: DueDayPickerState, day: number | undefined) => {
    if (savingDueDay) return;
    setSavingDueDay(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const cleanFrom = picker.fromDate.slice(0, 10);
      const existingMove = getBillDateMoveForOccurrence(picker.bill.id, cleanFrom);
      if (day === undefined) {
        if (existingMove) await removeBillOccurrenceMove(existingMove.id);
      } else {
        const targetDate = isoDateForMonthDay(selectedYear, month, day);
        if (targetDate === cleanFrom) {
          if (existingMove) await removeBillOccurrenceMove(existingMove.id);
        } else {
          await moveBillOccurrence(picker.bill.id, cleanFrom, targetDate);
        }
      }
      setDueDayPicker(null);
    } catch (error) {
      Alert.alert("Couldn’t save date", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingDueDay(false);
    }
  }, [getBillDateMoveForOccurrence, month, moveBillOccurrence, removeBillOccurrenceMove, savingDueDay, selectedYear]);

  const saveIncomeDateChange = useCallback(async (income: IncomeItem, day: number) => {
    if (savingIncomeDate) return;
    setSavingIncomeDate(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const date = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      await updateIncome({
        ...income,
        next_payment_date: date,
        start_date: income.start_date ?? date,
      });
      setIncomeDatePicker(null);
    } catch (error) {
      Alert.alert("Couldn’t save payday", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingIncomeDate(false);
    }
  }, [month, savingIncomeDate, selectedYear, updateIncome]);


  const handleQuickPaid = useCallback(async (billId: string, amount: number, isPaid: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const bill = bills.find(item => item.id === billId);
    const day = bill ? Math.min(new Date(selectedYear, month + 1, 0).getDate(), getCustomDueDay(bill.id, month, selectedYear) ?? bill.due_day) : 1;
    const paidDate = isoDateForMonthDay(selectedYear, month, day);
    const paidBefore = bill?.is_debt ? getPaidAmount(billId, month, selectedYear) : 0;
    if (isPaid) await removeDebtSurplusTransaction(billId);
    await setPaidAmount(billId, month, selectedYear, isPaid ? 0 : amount);
    if (!isPaid && bill?.is_debt) {
      const appliedAmount = Math.max(0, amount - paidBefore);
      if (appliedAmount > 0.005) showDebtPaymentNotice(bill, appliedAmount, paidDate, { scheduled: false, balanceBefore: bill.balance });
    }
  }, [setPaidAmount, removeDebtSurplusTransaction, bills, getCustomDueDay, getPaidAmount, showDebtPaymentNotice, month, selectedYear]);

  const showTransactionDebtNotice = useCallback((tx: Omit<Transaction, "id"> | Transaction) => {
    const linkedDebtId = tx.linked_bill_id ?? tx.debt_applied_bill_id;
    if (!linkedDebtId) return;
    const debt = bills.find(item => item.id === linkedDebtId);
    if (!debt?.is_debt) return;
    const amount = Math.abs(Number(tx.debt_applied_amount ?? tx.amount) || 0);
    if (amount <= 0.005 || Number(tx.amount) > 0) return;
    showDebtPaymentNotice(debt, amount, tx.date, {
      scheduled: tx.date > todayIsoDate(),
      balanceBefore: debt.balance,
    });
  }, [bills, showDebtPaymentNotice]);

  const handleApplyExtra = () => {
    const amt = parseFloat(extraPayment);
    if (isNaN(amt) || amt <= 0) return;
    const debtCount = bills.filter(b => b.is_debt && b.balance > 0).length;
    if (debtCount === 0) { Alert.alert("No Debts", "You have no active debts to apply extra payments to."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const preview = previewDebtSnowball(month, selectedYear, amt);
    setSnowballPreview(preview);
    setSnowballModalVisible(true);
    Keyboard.dismiss();
  };

  const updateSnowballAmount = (value: string) => {
    setExtraPayment(value);
    const amount = Number.parseFloat(value) || 0;
    setSnowballPreview(previewDebtSnowball(month, selectedYear, amount));
  };

  const confirmSnowballPayment = async () => {
    if (!snowballPreview) return;
    await applyDebtSnowballPayment(snowballPreview);
    setSnowballResults(snowballPreview.allocations.map(r => ({ name: r.billName, payment: r.payment, paidOff: r.paidOff })));
    setShowSnowballResults(true);
    setSnowballModalVisible(false);
    setExtraPayment("");
  };

  const handleDeleteTx = (id: string) => {
    const tx = transactions.find(transaction => transaction.id === id);
    const isTransfer = Boolean(tx?.transfer_group_id);
    const doDelete = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteTransaction(id); };
    confirmAction({
      title: isTransfer ? "Delete Transfer" : "Delete Transaction",
      message: isTransfer
        ? "Move both sides of this transfer to Recently Deleted?"
        : "Move this transaction to Recently Deleted? You can restore it from Settings.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: doDelete,
    });
  };

  const openAddTransaction = useCallback((date?: string | null) => {
    setEditTx(null);
    setTransactionDefaultDate(date ?? undefined);
    setSelectedDate(null);
    setTimeout(() => setTxModalVisible(true), 0);
  }, []);

  const openEditTransaction = useCallback((tx: Transaction) => {
    setEditTx(tx);
    setTransactionDefaultDate(tx.date);
    setSelectedDate(null);
    setTimeout(() => setTxModalVisible(true), 0);
  }, []);

  const handleDeletePlan = (decision: DecisionRecord) => {
    const doDelete = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void deleteDecision(decision.id); };
    confirmAction({
      title: "Remove Plan",
      message: `Remove "${decision.name}" from your calendar and forecast?`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: doDelete,
    });
  };

  const handleDeleteBillFromDay = useCallback((bill: Bill) => {
    const itemLabel = bill.is_debt ? "debt" : "bill";
    confirmAction({
      title: `Delete ${bill.is_debt ? "Debt" : "Bill"}`,
      message: `Delete "${bill.name}" completely? This removes it from Bills and Monthly. Existing Activity entries stay for history.`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await deleteBill(bill.id);
        } catch (error) {
          Alert.alert(`Couldn't delete ${itemLabel}`, error instanceof Error ? error.message : "Try again in a moment.");
        }
      },
    });
  }, [deleteBill]);

  const handleDeleteIncomeFromDay = useCallback((income: IncomeItem) => {
    confirmAction({
      title: "Delete Income",
      message: `Delete "${income.name}" completely? This removes its future income dates from Monthly and your forecast.`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await deleteIncome(income.id);
        } catch (error) {
          Alert.alert("Couldn't delete income", error instanceof Error ? error.message : "Try again in a moment.");
        }
      },
    });
  }, [deleteIncome]);

  const handleDeleteGoalFromDay = useCallback((goalId: string, goalName: string) => {
    confirmAction({
      title: "Delete Goal",
      message: `Delete "${goalName}" completely? This removes it from Monthly and your forecast.`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await deleteGoal(goalId);
        } catch (error) {
          Alert.alert("Couldn't delete goal", error instanceof Error ? error.message : "Try again in a moment.");
        }
      },
    });
  }, [deleteGoal]);

  const openEditPlan = (plan: DecisionRecord) => {
    setEditPlan(plan);
    setEditPlanName(plan.name);
    setEditPlanAmount(String(Math.abs(plan.scenario.amount)));
    setEditPlanDate(plan.scenario.date);
  };

  const saveEditedPlan = async () => {
    if (!editPlan || savingPlan) return;
    const amount = Number.parseFloat(editPlanAmount);
    const name = editPlanName.trim() || editPlan.name;
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Amount needed", "Enter an amount greater than $0.");
      return;
    }
    setSavingPlan(true);
    try {
      const baseline = dailyBalances
        .map(day => ({
          date: `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
          balance: day.balance,
        }))
        .filter(day => day.date >= editPlanDate);
      const scenario = { ...editPlan.scenario, name, amount, date: editPlanDate };
      const result = evaluateDecision(baseline.length ? baseline : [{ date: scenario.date, balance: 0 }], scenario, settings.safety_floor);
      await updateDecision({ ...editPlan, name, scenario, result, calendar_date: editPlanDate, next_due_date: editPlanDate });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedDate(editPlanDate);
      setEditPlan(null);
    } catch (error) {
      Alert.alert("Couldn’t save plan", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingPlan(false);
    }
  };

  const checkForRecurring = useCallback((newTx: Omit<Transaction, "id">) => {
    // Only check expenses with a non-trivial note
    if (newTx.amount >= 0) return;
    const newNote = newTx.note.trim().toLowerCase();
    if (newNote.length < 3) return;

    const [newY, newM] = newTx.date.split("-").map(Number);
    const seenMonths = new Set<string>();

    for (const tx of transactions) {
      if (tx.amount >= 0) continue;
      const txNote = tx.note.trim().toLowerCase();
      if (txNote !== newNote) continue;
      const [ty, tm] = tx.date.split("-").map(Number);
      if (ty === newY && tm === newM) continue; // same month, skip
      seenMonths.add(`${ty}-${tm}`);
    }

    if (seenMonths.size >= 1) {
      const absAmt = Math.abs(newTx.amount);
      const displayName = newTx.note.trim();
      const dueDay = parseInt(newTx.date.split("-")[2], 10);
      Alert.alert(
        "Recurring Expense?",
        `"${displayName}" ($${absAmt.toFixed(2)}) has appeared in multiple months. Would you like to add it as a recurring bill?`,
        [
          { text: "No Thanks", style: "cancel" },
          {
            text: "Add as Bill",
            onPress: () => {
              addBill({
                name: displayName,
                amount: absAmt,
                category: newTx.category,
                due_day: dueDay,
                is_recurring: true,
                is_debt: false,
                frequency: "monthly",
                priority: 0,
                balance: 0,
                interest_rate: 0,
              });
              Alert.alert("Bill Added", `"${displayName}" has been added as a monthly recurring bill on ${MONTH_FULL[month]} ${dueDay}, ${selectedYear}.`);
            },
          },
        ]
      );
    }
  }, [transactions, addBill]);

  const displayedTxs = selectedDate
    ? calendarTransactions.filter(t => t.date === selectedDate).filter(transaction => {
      const allocations = transaction.review_allocations ?? [];
      if (allocations.some(allocation => allocation.type === "planned_expense")) return false;
      return !allocations.some(allocation =>
        allocation.type === "bill"
        && allocation.settlement === "partial"
        && allocation.occurrenceDate === selectedDate
        && scheduledBillsForDay.some(bill => bill.id === allocation.targetId));
    })
    : [];
  const rawSelectedForecastEventCount = selectedForecastGroups.reduce((sum, group) => sum + group.events.length, 0);
  const groupedBucketEventReduction = plannedExpenseGroupsForSelectedDay.reduce((sum, group) =>
    sum + Math.max(0, group.transactionIds.length - 1) + (group.remainingAmount > 0.005 ? 1 : 0), 0);
  const selectedForecastEventCount = Math.max(0, rawSelectedForecastEventCount - groupedBucketEventReduction);
  const selectedVisibleItemCount = scheduledBillsForDay.length + selectedDebtPayments.length + incomeForSelectedDay.length + displayedTxs.length + plannedExpenseGroupsForSelectedDay.length + displayedGoalsForSelectedDay.length + plansForSelectedDay.length;
  const selectedDayItemCount = Math.max(selectedForecastEventCount, selectedVisibleItemCount);

  const changeMonth = useCallback((delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate(null);
    setMonth(currentMonth => {
      let nextMonth = currentMonth + delta;
      let nextYear = selectedYear;
      while (nextMonth < 0) {
        nextMonth += 12;
        nextYear -= 1;
      }
      while (nextMonth > 11) {
        nextMonth -= 12;
        nextYear += 1;
      }
      if (nextYear !== selectedYear) setSelectedYear(nextYear);
      return nextMonth;
    });
  }, [selectedYear, setSelectedYear]);

  const calendarSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 28 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx <= -48) changeMonth(1);
      else if (gesture.dx >= 48) changeMonth(-1);
    },
  }), [changeMonth]);

  const todayDate = new Date();
  const todayMonth = todayDate.getMonth();
  const todayYear = todayDate.getFullYear();
  const todayDayNumber = todayDate.getDate();
  const todayIso = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-${String(todayDayNumber).padStart(2, "0")}`;
  const isCurrentMonth = month === todayMonth && selectedYear === todayYear;

  const jumpToToday = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate(todayIso);
    setMonth(todayMonth);
    if (selectedYear !== todayYear) setSelectedYear(todayYear);
  }, [selectedYear, setSelectedYear, todayIso, todayMonth, todayYear]);

  const monthSearchOptions = useMemo(() => {
    const query = monthSearchQuery.trim().toLowerCase();
    return MONTH_FULL
      .map((name, index) => ({ name, index, short: name.slice(0, 3).toUpperCase() }))
      .filter(option => {
        if (!query) return true;
        return option.name.toLowerCase().includes(query) || option.short.toLowerCase().includes(query);
      });
  }, [monthSearchQuery]);

  const openMonthSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMonthSearchQuery("");
    setMonthSearchVisible(true);
  }, []);

  const closeMonthSearch = useCallback(() => {
    Keyboard.dismiss();
    setMonthSearchVisible(false);
  }, []);

  const chooseMonthFromSearch = useCallback((nextMonth: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMonth(nextMonth);
    setSelectedDate(null);
    closeMonthSearch();
  }, [closeMonthSearch]);

  const changeSearchYear = useCallback((delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextYear = selectedYear + delta;
    setSelectedYear(nextYear);
    setSelectedDate(isoDateForMonthDay(nextYear, month, 1));
  }, [month, selectedYear, setSelectedYear]);

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="purple" />
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.calendarBrand, { color: c.primary }]}>FLOWLEDGER ALGO</Text>
          <Text style={[styles.calendarScreenLabel, { color: c.foreground }]}>Calendar</Text>
          {isFuture && <Text style={[styles.forecastTag, { color: c.primary }]}>Forecast Mode</Text>}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={jumpToToday}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            style={({ pressed }) => [
              styles.todayChip,
              {
                borderColor: isCurrentMonth ? c.primary : "rgba(226,232,240,0.58)",
                backgroundColor: isCurrentMonth ? c.primary : "rgba(2,6,23,0.58)",
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Text style={[styles.todayChipText, { color: isCurrentMonth ? c.primaryForeground : c.foreground }]}>
              {todayDayNumber}
            </Text>
          </Pressable>
          <CommandPlusButton
            onPress={() => openAddTransaction(selectedDate)}
            accessibilityLabel="Add to calendar"
          />
        </View>
      </View>

      <View
        style={[
          styles.calendarMonthBar,
          {
            backgroundColor: c.isDark ? "rgba(2,6,23,0.32)" : "rgba(255,255,255,0.82)",
            borderColor: c.isDark ? "rgba(148,163,184,0.12)" : "rgba(15,23,42,0.10)",
          },
        ]}
      >
        <Pressable
          onPress={() => changeMonth(-1)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.monthArrowBtn,
            {
              backgroundColor: c.isDark ? "rgba(15,23,42,0.58)" : "rgba(226,232,240,0.85)",
              opacity: pressed ? 0.55 : 1,
            },
          ]}
        >
          <Feather name="chevron-left" size={24} color={c.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={openMonthSearch}
          accessibilityRole="button"
          accessibilityLabel={`Search months. Current month is ${MONTH_FULL[month]} ${selectedYear}`}
          style={({ pressed }) => [styles.monthCenterLabel, pressed && styles.monthCenterPressed]}
        >
          <Text style={[styles.monthShortTitle, { color: c.foreground }]}>{MONTH_FULL[month].slice(0, 3).toUpperCase()}</Text>
          {selectedYear !== todayYear && (
            <Text style={[styles.monthSwipeHint, { color: c.mutedForeground }]}>{selectedYear}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => changeMonth(1)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.monthArrowBtn,
            {
              backgroundColor: c.isDark ? "rgba(15,23,42,0.58)" : "rgba(226,232,240,0.85)",
              opacity: pressed ? 0.55 : 1,
            },
          ]}
        >
          <Feather name="chevron-right" size={24} color={c.mutedForeground} />
        </Pressable>
      </View>

      {activeTab === "bills" ? (
          <FlatList
            data={billsWithData}
            keyExtractor={item => item.bill.id}
            style={{ flex: 1 }}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<EmptyState icon="calendar" title="No Bills" message="Add recurring bills to track them here." />}
            ListHeaderComponent={
              <>
                <View style={[styles.summaryRow, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 10 }]}>
                  {[
                    { label: "Due", value: `$${totalDue.toFixed(0)}`, color: c.foreground },
                    { label: "Paid", value: `$${totalPaid.toFixed(0)}`, color: c.success },
                    { label: "Left", value: `$${Math.max(0, totalDue - totalPaid).toFixed(0)}`, color: c.destructive },
                  ].map((s, i) => (
                    <React.Fragment key={s.label}>
                      {i > 0 && <View style={[styles.sep, { backgroundColor: c.border }]} />}
                      <View style={styles.summaryItem}>
                        <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{s.label}</Text>
                        <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>

                {settings.zeroBasedBudgetEnabled && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${MONTH_FULL[month]} zero-based budget`}
                    onPress={() => router.push("/(tabs)/category-budget" as any)}
                    style={({ pressed }) => [styles.zeroBudgetMonthlyLink, { backgroundColor: c.primary + "14", borderColor: c.primary + "35", opacity: pressed ? 0.78 : 1 }]}
                  >
                    <View style={[styles.zeroBudgetMonthlyIcon, { backgroundColor: c.primary + "18" }]}><Feather name="pie-chart" size={15} color={c.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.zeroBudgetMonthlyTitle, { color: c.foreground }]}>Zero-Based Plan</Text>
                      <Text style={[styles.zeroBudgetMonthlyText, { color: c.mutedForeground }]}>Assign or move money.</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={c.primary} />
                  </Pressable>
                )}

                {monthlyIncome > 0 && (
                  <View style={[styles.cfBar, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: 10, marginTop: 8 }]}>
                    <View style={styles.cfBarInner}>
                      <Text style={[styles.cfLabel, { color: c.mutedForeground }]}>
                        {isFuture ? "Forecast" : "Available"} Cash
                      </Text>
                      <Text style={[styles.cfValue, { color: cashFlow.remaining >= 0 ? c.success : c.destructive }]}>
                        {cashFlow.remaining >= 0 ? "+" : ""}${cashFlow.remaining.toFixed(0)}
                      </Text>
                    </View>
                  </View>
                )}

                {incomeOccurrences.length > 0 && (
                  <View style={[styles.incomeCard, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 8 }]}>
                    <View style={styles.incomeHeader}>
                      <Feather name="trending-up" size={14} color={c.success} />
                      <Text style={[styles.incomeTitle, { color: c.foreground }]}>Income This Month</Text>
                      <Text style={[styles.incomeTotalText, { color: c.success }]}>
                        ${incomeOccurrences.reduce((s, o) => s + o.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </Text>
                    </View>
                    {incomeOccurrences.map((occ, idx) => (
                      <View key={`${occ.name}-${occ.day}-${idx}`} style={[styles.incomeRow, idx > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
                        <View style={[styles.incomeDayBadge, { backgroundColor: c.success + "22" }]}>
                          <Text style={[styles.incomeDayNum, { color: c.success }]}>{occ.day}</Text>
                        </View>
                        <Text style={[styles.incomeName, { color: c.foreground }]}>{occ.name}</Text>
                        <Text style={[styles.incomeAmt, { color: c.success }]}>+${occ.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {settings.debtPayoffEnabled && <View style={[styles.extraCard, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 8 }]}>
                  <View style={styles.extraHeader}>
                    <Feather name="zap" size={14} color={c.primary} />
                    <Text style={[styles.extraTitle, { color: c.foreground }]}>
                      Extra Debt Payment ({settings.paymentMethod === "snowball" ? "Snowball" : "Avalanche"})
                    </Text>
                  </View>
                  <View style={styles.extraRow}>
                    <TextInput
                      style={[styles.extraInput, { backgroundColor: c.muted, color: c.foreground }]}
                      value={extraPayment}
                      onChangeText={setExtraPayment}
                      placeholder="$ amount"
                      placeholderTextColor={c.mutedForeground}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      onSubmitEditing={handleApplyExtra}
                    />
                    <Pressable
                      onPress={handleApplyExtra}
                      style={({ pressed }) => [styles.applyBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Text style={[styles.applyBtnText, { color: c.primaryForeground }]}>Apply Extra</Text>
                    </Pressable>
                  </View>
                  {showSnowballResults && snowballResults.length > 0 && (
                    <View style={[styles.resultsBox, { backgroundColor: c.muted, borderRadius: 8 }]}>
                      {snowballResults.map((r, i) => (
                        <View key={i} style={styles.resultRow}>
                          <Feather name={r.paidOff ? "check-circle" : "arrow-right"} size={13} color={r.paidOff ? c.success : c.primary} />
                          <Text style={[styles.resultText, { color: r.paidOff ? c.success : c.foreground }]}>
                            {r.name}: <Text style={{ fontFamily: "Inter_700Bold" }}>${r.payment.toFixed(2)}</Text>
                            {r.paidOff ? " — PAID OFF! 🎉" : ""}
                          </Text>
                        </View>
                      ))}
                      <Pressable onPress={() => setShowSnowballResults(false)} style={styles.dismissBtn}>
                        <Text style={[styles.dismissText, { color: c.mutedForeground }]}>Dismiss</Text>
                      </Pressable>
                    </View>
                  )}
                </View>}

                <View style={[styles.billFilterRow, { paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }]}>
                  {(["all", "paid", "unpaid"] as const).map(f => (
                    <Pressable key={f} onPress={() => setBillFilter(f)} style={[styles.pill, { backgroundColor: billFilter === f ? c.primary : c.muted, borderRadius: 20 }]}>
                      <Text style={[styles.pillText, { color: billFilter === f ? c.primaryForeground : c.mutedForeground }]}>
                        {f === "all" ? "All" : f === "paid" ? "Paid" : "Unpaid"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            }
            renderItem={({ item: { bill, amount, perOccurrence, paid, effectivePaid, isPaid, isPartial } }) => {
              const borderColor = isPaid ? c.success : isPartial ? c.warning : c.destructive;
              const amtKey = `${bill.id}-${month}-${selectedYear}-amt`;
              const paidKey = `${bill.id}-${month}-${selectedYear}-paid`;
              const dayKey = `${bill.id}-${month}-${selectedYear}-day`;
              const isWeekly = bill.frequency === "weekly";
              const occCount = isWeekly ? Math.round(amount / (perOccurrence || 1)) : 1;
              // For weekly bills: the TextInput edits the per-occurrence (weekly) amount
              const editableAmt = isWeekly ? perOccurrence : amount;
              const showAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : editableAmt.toFixed(2);
              const showPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
              const remaining = Math.max(0, amount - effectivePaid);
              const customDay = getCustomDueDay(bill.id, month, selectedYear);
              const effectiveDueDay = customDay ?? bill.due_day;
              const WEEKDAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

              return (
                <View style={[styles.entryCard, { backgroundColor: c.card, borderRadius: colors.radius, borderLeftColor: borderColor }]}>
                  <View style={styles.entryTop}>
                    <View style={styles.entryLeft}>
                      <Text style={[styles.entryName, { color: c.foreground }]}>{bill.name}</Text>
                      <Text style={[styles.entryMeta, { color: c.mutedForeground }]}>
                        {isWeekly
                          ? `Every ${WEEKDAY_NAMES[bill.day_of_week ?? 0]} · ×${occCount} this month · ${bill.category}`
                          : `Due ${MONTH_FULL[month]} ${effectiveDueDay}, ${selectedYear}${customDay !== undefined ? " *" : ""} · ${bill.category}`}
                      </Text>
                    </View>
                    <View style={styles.entryRight}>
                      <PayStatus paid={isPaid} partial={isPartial} />
                      <Pressable
                        onPress={() => handleQuickPaid(bill.id, amount, isPaid)}
                        style={({ pressed }) => [styles.quickPaidBtn, { backgroundColor: isPaid ? c.muted : c.success + "20", opacity: pressed ? 0.7 : 1, borderRadius: 8, marginTop: 6 }]}
                      >
                        <Feather name={isPaid ? "x" : "check"} size={12} color={isPaid ? c.mutedForeground : c.success} />
                        <Text style={[styles.quickPaidText, { color: isPaid ? c.mutedForeground : c.success }]}>
                          {isPaid ? "Unpay" : "Mark Paid"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Weekly breakdown chip */}
                  {isWeekly && (
                    <View style={[styles.weeklyChip, { backgroundColor: c.primary + "12" }]}>
                      <Feather name="repeat" size={10} color={c.primary} />
                      <Text style={[styles.weeklyChipText, { color: c.primary }]}>
                        ${perOccurrence.toFixed(2)}/wk × {occCount} = ${amount.toFixed(2)} total this month
                      </Text>
                    </View>
                  )}

                  <View style={styles.amtRow}>
                    <View style={styles.amtField}>
                      {/* Label row: shows "This month" badge + reset × when overridden */}
                      {(() => {
                        const hasCustomAmt = Math.abs(editableAmt - bill.amount) > 0.001;
                        return (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
                            <Text style={[styles.fieldLabel, { color: hasCustomAmt ? c.primary : c.mutedForeground, marginBottom: 0 }]}>
                              {isWeekly ? "Per Week" : "Amount"}{hasCustomAmt ? " ✎" : ""}
                            </Text>
                            {hasCustomAmt && (
                              <Pressable
                                onPress={() => { setCustomAmount(bill.id, month, selectedYear, undefined); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                                hitSlop={8}
                              >
                                <Feather name="x-circle" size={13} color={c.mutedForeground} />
                              </Pressable>
                            )}
                          </View>
                        );
                      })()}
                      <TextInput
                        style={[styles.fieldInput, {
                          backgroundColor: Math.abs(editableAmt - bill.amount) > 0.001 ? c.primary + "18" : c.muted,
                          color: Math.abs(editableAmt - bill.amount) > 0.001 ? c.primary : c.foreground,
                          marginTop: 0,
                        }]}
                        value={showAmt}
                        onChangeText={v => setEditingAmounts(p => ({ ...p, [amtKey]: v }))}
                        onFocus={() => setEditingAmounts(p => ({ ...p, [amtKey]: editableAmt.toFixed(2) }))}
                        onBlur={() => handleAmtBlur({ id: bill.id, amount: bill.amount }, amtKey)}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Paid</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: isPaid ? c.success + "20" : c.muted, color: isPaid ? c.success : c.foreground }]}
                        value={showPaid}
                        onChangeText={v => {
                          editingPaidRef.current = { ...editingPaidRef.current, [paidKey]: v };
                          setEditingPaid(p => ({ ...p, [paidKey]: v }));
                        }}
                        onFocus={() => {
                          const focusValue = paid > 0 ? paid.toFixed(2) : "";
                          editingPaidRef.current = { ...editingPaidRef.current, [paidKey]: focusValue };
                          setEditingPaid(p => ({ ...p, [paidKey]: focusValue }));
                        }}
                        onBlur={() => handlePaidBlur(bill.id, paidKey, editingPaidRef.current[paidKey] ?? showPaid)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={c.mutedForeground}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                    </View>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Left</Text>
                      <View style={[styles.leftBox, { backgroundColor: remaining > 0 ? c.destructive + "15" : c.success + "15" }]}>
                        <Text style={[styles.leftText, { color: remaining > 0 ? c.destructive : c.success }]}>${remaining.toFixed(2)}</Text>
                      </View>
                    </View>
                  </View>

                  {bill.frequency === "monthly" && (
                    <View style={styles.dueDayRow}>
                      <Feather name="calendar" size={11} color={customDay !== undefined ? c.primary : c.mutedForeground} style={{ marginRight: 6 }} />
                      <Text style={[styles.fieldLabel, { color: customDay !== undefined ? c.primary : c.mutedForeground, marginBottom: 0, marginRight: 8 }]}>
                        {customDay !== undefined ? "Due date this month:" : "Due date (this month only):"}
                      </Text>
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setDueDayPicker({ bill, fromDate: isoDateForMonthDay(selectedYear, month, effectiveDueDay) });
                        }}
                        style={({ pressed }) => [
                          styles.dueDayInput,
                          {
                            backgroundColor: customDay !== undefined ? c.primary + "15" : c.muted,
                            borderColor: customDay !== undefined ? c.primary + "40" : "transparent",
                            opacity: pressed ? 0.7 : 1,
                            alignItems: "center",
                            justifyContent: "center",
                          },
                        ]}
                      >
                        <Text style={{ color: customDay !== undefined ? c.primary : c.foreground, fontSize: 15, fontFamily: "Inter_600SemiBold" }}>
                          {effectiveDueDay}
                        </Text>
                      </Pressable>
                      {customDay !== undefined && (
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setCustomDueDay(bill.id, month, selectedYear, undefined)
                              .catch(error => Alert.alert("Couldn’t save date", error instanceof Error ? error.message : "Please try again."));
                          }}
                          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginLeft: 6 })}
                          hitSlop={8}
                        >
                          <Feather name="x-circle" size={14} color={c.mutedForeground} />
                        </Pressable>
                      )}
                    </View>
                  )}

                  {bill.is_debt && bill.balance > 0 && (
                    <View style={[styles.debtNote, { backgroundColor: c.muted }]}>
                      <Text style={[styles.debtNoteText, { color: c.mutedForeground }]}>
                        Debt balance: <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold" }}>${bill.balance.toFixed(2)}</Text>
                        {bill.interest_rate > 0 ? ` · ${bill.interest_rate}% APR` : ""}
                        {` · Payoff priority #${bill.priority}`}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
      ) : (
        <View style={[styles.calFixed, { paddingBottom: insets.bottom + 92 }]}>
          <View style={styles.calInner}>
            <View {...(Platform.OS === "web" ? {} : calendarSwipeResponder.panHandlers)}>
              <CalendarView
                month={month}
                year={selectedYear}
                transactions={calendarTransactions}
                selectedDate={selectedDate}
                onDayPress={(date) => setSelectedDate(date)}
                dailyBalances={dailyBalances}
                goals={goals}
                decisions={decisions}
                safetyFloor={settings.safety_floor}
                startDate={settings.calendar_start_date ?? settings.starting_balance_date}
              />
            </View>

            <Modal
              visible={selectedDate !== null}
              animationType="fade"
              transparent
              onRequestClose={() => setSelectedDate(null)}
            >
              <Pressable style={styles.dayOverlayBackdrop} onPress={() => setSelectedDate(null)}>
                <Pressable
                  style={[
                    styles.dayOverlayCard,
                    {
                      backgroundColor: c.isDark ? "rgba(8,13,30,0.96)" : "rgba(255,255,255,0.98)",
                      borderColor: c.isDark ? "rgba(148,163,184,0.20)" : "rgba(15,23,42,0.12)",
                    },
                  ]}
                  onPress={e => e.stopPropagation()}
                >
                  <View style={styles.dayOverlayHeader}>
                    <View style={styles.dayOverlayDateBlock}>
                      <Text style={[styles.dayOverlayBigDay, { color: c.foreground }]}>
                        {selectedDay ?? ""}
                      </Text>
                      <View>
                        <Text style={[styles.dayOverlayTitle, { color: c.foreground }]}>
                          {selectedDate ? formatLongDate(selectedDate) : ""}
                        </Text>
                        <Text style={[styles.dayOverlaySub, { color: c.mutedForeground }]}>
                          {selectedDayItemCount} item{selectedDayItemCount === 1 ? "" : "s"}
                          {selectedForecastDay ? ` · projected close $${selectedForecastDay.balance.toFixed(2)}` : ""}
                        </Text>
                      </View>
                    </View>
                    <Pressable onPress={() => setSelectedDate(null)} hitSlop={8}>
                      <Feather name="x" size={22} color={c.mutedForeground} />
                    </Pressable>
                  </View>

                  <ScrollView style={styles.dayOverlayScroll} contentContainerStyle={styles.dayOverlayScrollContent}>
                    {selectedForecastDay && selectedForecastDay.balance < settings.safety_floor ? (
                      <View style={[styles.dayOverlayRisk, { backgroundColor: selectedForecastDay.balance < 0 ? c.destructive + "14" : c.warning + "16", borderColor: selectedForecastDay.balance < 0 ? c.destructive + "70" : c.warning + "70" }]}>
                        <Feather name="alert-triangle" size={16} color={selectedForecastDay.balance < 0 ? c.destructive : c.warning} />
                        <Text style={[styles.dayOverlayRiskText, { color: c.foreground }]}>
                          Projected below your ${settings.safety_floor.toFixed(0)} safety floor.
                        </Text>
                      </View>
                    ) : null}

                    {incomeForSelectedDay.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Income</Text>
                        {incomeForSelectedDay.map(item => (
                          <View key={`overlay-income-${item.incomeId}-${item.day}`} style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: c.success + "40" }]}>
                            <View style={styles.dayBillTop}>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{item.name}</Text>
                                <Text style={[styles.dayBillMeta, { color: c.mutedForeground }]}>{FREQ_LABELS[item.frequency] ?? item.frequency}</Text>
                              </View>
                              <Text style={[styles.dayOverlayAmount, { color: c.success }]}>+${item.amount.toFixed(2)}</Text>
                            </View>
                            <View style={styles.dayBillActions}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Change date for ${item.name}`}
                                onPress={() => {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                  setSelectedDate(null);
                                  setIncomeDatePicker({ income: item.income, day: item.day, amount: item.amount });
                                }}
                                style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="calendar" size={13} color={c.primary} />
                                <Text style={[styles.dayBillActionText, { color: c.primary }]}>Change date</Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Delete ${item.name}`}
                                onPress={() => handleDeleteIncomeFromDay(item.income)}
                                style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="trash-2" size={13} color={c.destructive} />
                                <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Delete</Text>
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {scheduledBillsForDay.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Bills due this day</Text>
                        {scheduledBillsForDay.map(bill => {
                          const amount = getAmount(bill, month, selectedYear);
                          const paid = getPaidAmount(bill.id, month, selectedYear);
                          const effectivePaid = getEffectivePaidAmount(bill, month, selectedYear);
                          const isPaid = amount > 0 && effectivePaid >= amount - 0.005;
                          const isPartial = effectivePaid > 0 && !isPaid;
                          const remaining = Math.max(0, amount - effectivePaid);
                          const movedIn = movedInByBillId.get(bill.id);
                          const canReschedule = bill.frequency === "monthly";
                          const amtKey = `${bill.id}-overlay-amount`;
                          const showAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : amount.toFixed(2);
                          const amountEditing = editingAmounts[amtKey] !== undefined;
                          const paidKey = `${bill.id}-overlay-paid`;
                          const showPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
                          const paidEditing = editingPaid[paidKey] !== undefined;
                          return (
                            <View key={`overlay-bill-${bill.id}`} style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: isPaid ? c.success + "40" : isPartial ? c.warning + "45" : c.border }]}>
                              <View style={styles.dayBillTop}>
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{bill.name}</Text>
                                  <Text style={[styles.dayBillMeta, { color: c.mutedForeground }]}>
                                    {bill.category}{bill.is_debt ? " · debt" : ""}{movedIn ? ` · moved from ${formatShortDate(movedIn.from_date)}` : ""}
                                  </Text>
                                </View>
                                <PayStatus paid={isPaid} partial={isPartial} />
                              </View>
                              <View style={styles.dayBillNumbers}>
                                <View style={[styles.dayBillNumberTile, styles.dayBillPaidTile, { backgroundColor: c.background + "66", borderColor: amountEditing ? c.primary + "80" : c.border }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Amount</Text>
                                  <View style={styles.dayBillPaidInputRow}>
                                    <Text style={[styles.dayBillPaidDollar, { color: c.foreground }]}>$</Text>
                                    <TextInput
                                      value={showAmt}
                                      onChangeText={text => setEditingAmounts(current => ({ ...current, [amtKey]: text }))}
                                      onFocus={() => setEditingAmounts(current => ({ ...current, [amtKey]: showAmt || amount.toFixed(2) }))}
                                      onBlur={() => handleAmtBlur({ id: bill.id, amount: bill.amount }, amtKey)}
                                      keyboardType="decimal-pad"
                                      returnKeyType="done"
                                      blurOnSubmit
                                      placeholder="0.00"
                                      placeholderTextColor={c.mutedForeground}
                                      selectTextOnFocus
                                      style={[styles.dayBillPaidInput, { color: c.foreground }]}
                                    />
                                    {amountEditing ? (
                                      <Pressable
                                        onPress={() => handleAmtBlur({ id: bill.id, amount: bill.amount }, amtKey)}
                                        hitSlop={8}
                                        style={[styles.dayBillPaidSave, { backgroundColor: c.primary + "22" }]}
                                      >
                                        <Feather name="check" size={12} color={c.primary} />
                                      </Pressable>
                                    ) : null}
                                  </View>
                                </View>
                                <View style={[styles.dayBillNumberTile, styles.dayBillPaidTile, { backgroundColor: c.background + "66", borderColor: editingPaid[paidKey] !== undefined ? c.primary + "80" : c.border }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Paid</Text>
                                  <View style={styles.dayBillPaidInputRow}>
                                    <Text style={[styles.dayBillPaidDollar, { color: showPaid ? c.success : c.mutedForeground }]}>$</Text>
                                    <TextInput
                                      value={showPaid}
                                      onChangeText={text => {
                                        editingPaidRef.current = { ...editingPaidRef.current, [paidKey]: text };
                                        setEditingPaid(current => ({ ...current, [paidKey]: text }));
                                      }}
                                      onFocus={() => {
                                        editingPaidRef.current = { ...editingPaidRef.current, [paidKey]: showPaid || "" };
                                        setEditingPaid(current => ({ ...current, [paidKey]: showPaid || "" }));
                                      }}
                                      onBlur={() => handlePaidBlur(bill.id, paidKey, editingPaidRef.current[paidKey] ?? showPaid)}
                                      keyboardType="decimal-pad"
                                      returnKeyType="done"
                                      blurOnSubmit
                                      placeholder="0.00"
                                      placeholderTextColor={c.mutedForeground}
                                      selectTextOnFocus
                                      style={[styles.dayBillPaidInput, { color: showPaid ? c.success : c.mutedForeground }]}
                                    />
                                    {paidEditing ? (
                                      <Pressable
                                        disabled={savingPaidKey === paidKey}
                                        onPress={() => handlePaidBlur(bill.id, paidKey, editingPaidRef.current[paidKey] ?? showPaid)}
                                        hitSlop={8}
                                        style={[styles.dayBillPaidSave, { backgroundColor: c.primary + "22", opacity: savingPaidKey === paidKey ? 0.5 : 1 }]}
                                      >
                                        <Feather name="check" size={12} color={c.primary} />
                                      </Pressable>
                                    ) : null}
                                  </View>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
                                  <Text style={[styles.dayBillNumberValue, { color: remaining > 0 ? c.destructive : c.success }]}>${remaining.toFixed(2)}</Text>
                                </View>
                              </View>
                              <View style={styles.dayBillActions}>
                                <Pressable
                                  onPress={() => handleQuickPaid(bill.id, amount, isPaid)}
                                  style={({ pressed }) => [styles.dayBillAction, { backgroundColor: isPaid ? c.background : c.success + "20", borderColor: isPaid ? c.border : c.success + "35", opacity: pressed ? 0.74 : 1 }]}
                                >
                                  <Feather name={isPaid ? "x" : "check"} size={13} color={isPaid ? c.mutedForeground : c.success} />
                                  <Text style={[styles.dayBillActionText, { color: isPaid ? c.mutedForeground : c.success }]}>{isPaid ? "Unpay" : "Mark paid"}</Text>
                                </Pressable>
                                {canReschedule ? (
                                  <Pressable
                                    onPress={() => {
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                      const fromDate = movedInByBillId.get(bill.id)?.from_date ?? selectedDate;
                                      setSelectedDate(null);
                                      if (fromDate) setDueDayPicker({ bill, fromDate });
                                    }}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="calendar" size={13} color={c.primary} />
                                    <Text style={[styles.dayBillActionText, { color: c.primary }]}>Change date</Text>
                                  </Pressable>
                                ) : null}
                                <Pressable
                                  onPress={() => handleDeleteBillFromDay(bill)}
                                  style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                                >
                                  <Feather name="trash-2" size={13} color={c.destructive} />
                                  <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Delete</Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {selectedDebtPayments.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Planned debt payments</Text>
                        {selectedDebtPayments.map(payment => {
                          const savedPayment = extraPayments.find(item => item.id === payment.event.sourceId);
                          const amount = Math.abs(payment.event.amount);
                          const applied = payment.statusLabel.toLowerCase() === "applied";
                          const allocatedDebtIds = new Set(savedPayment?.allocations.map(allocation => allocation.billId) ?? []);
                          const requiredMinimum = savedPayment
                            ? bills
                              .filter(bill => bill.is_debt && allocatedDebtIds.has(bill.id))
                              .reduce((total, bill) => total + getBillMonthlyTotal(bill, savedPayment.month, savedPayment.year), 0)
                            : 0;
                          const paymentPlan = buildDebtPaymentPlanSummary(requiredMinimum, amount);
                          return (
                            <View
                              key={`overlay-debt-${payment.event.id}`}
                              style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: "#3b82f640" }]}
                            >
                              <View style={styles.dayBillTop}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>
                                    {payment.label.replace(/ debt payment$/i, "")}
                                  </Text>
                                  <Text style={[styles.dayBillMeta, { color: c.mutedForeground }]}>Snowball payment</Text>
                                </View>
                                <View style={[styles.dayTransactionBadge, { backgroundColor: "#3b82f620" }]}>
                                  <Text style={[styles.dayTransactionBadgeText, { color: "#3b82f6" }]}>{payment.statusLabel.toUpperCase()}</Text>
                                </View>
                              </View>
                              <View style={styles.dayBillNumbers}>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Amount</Text>
                                  <Text style={[styles.dayBillNumberValue, { color: c.foreground }]}>${amount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Paid</Text>
                                  <Text style={[styles.dayBillNumberValue, { color: applied ? c.success : c.mutedForeground }]}>${(applied ? amount : 0).toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
                                  <Text style={[styles.dayBillNumberValue, { color: applied ? c.success : c.warning }]}>${(applied ? 0 : amount).toFixed(2)}</Text>
                                </View>
                              </View>
                              {savedPayment ? (
                                <View style={[styles.dayDebtPlanSummary, { backgroundColor: c.background + "66", borderColor: c.border }]}>
                                  <Text style={[styles.dayDebtPlanText, { color: c.mutedForeground }]}>Minimum {`$${paymentPlan.requiredMinimum.toFixed(2)}`} + extra {`$${paymentPlan.extraPayment.toFixed(2)}`}</Text>
                                  <Text style={[styles.dayDebtPlanTotal, { color: c.success }]}>{`$${paymentPlan.totalPlanned.toFixed(2)}`} planned this month</Text>
                                  <Text style={[styles.dayDebtPlanNote, { color: c.mutedForeground }]}>The required minimum stays the same.</Text>
                                </View>
                              ) : null}
                              {savedPayment ? (
                                <View style={styles.dayBillActions}>
                                  <Pressable
                                    onPress={() => {
                                      setSelectedDate(null);
                                      router.push("/snowball-plan" as never);
                                    }}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="edit-2" size={13} color={c.primary} />
                                    <Text style={[styles.dayBillActionText, { color: c.primary }]}>Edit</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => confirmAction({
                                      title: "Remove this debt payment?",
                                      message: "This undoes the snowball payment and restores the debt balances it changed.",
                                      confirmText: "Remove payment",
                                      destructive: true,
                                      onConfirm: async () => {
                                        await removeDebtSnowballPayment(savedPayment.month, savedPayment.year);
                                        setSelectedDate(null);
                                      },
                                    })}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="rotate-ccw" size={13} color={c.destructive} />
                                    <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Remove</Text>
                                  </Pressable>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {displayedGoalsForSelectedDay.length > 0 || plansForSelectedDay.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Plans & goals</Text>
                        {displayedGoalsForSelectedDay.map(goal => (
                          <View key={`overlay-goal-${goal.id}`} style={styles.dayOverlayRow}>
                            <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>★ {goal.name}</Text>
                            <Text style={[styles.dayOverlayAmount, { color: "#8b5cf6" }]}>-${goal.amount.toFixed(2)}</Text>
                            <Pressable
                              onPress={() => handleDeleteGoalFromDay(goal.id, goal.name)}
                              hitSlop={8}
                              style={({ pressed }) => [styles.dayOverlayDeleteButton, { backgroundColor: c.destructive + "12", opacity: pressed ? 0.74 : 1 }]}
                            >
                              <Feather name="trash-2" size={14} color={c.destructive} />
                            </Pressable>
                          </View>
                        ))}
                        {plansForSelectedDay.map(plan => {
                          const amount = plan.scenario.type === "income_change" ? Math.abs(plan.scenario.amount) : -Math.abs(plan.scenario.amount);
                          return (
                            <View key={`overlay-plan-${plan.id}`} style={styles.dayOverlayRow}>
                              <Pressable onPress={() => openEditPlan(plan)} style={styles.dayOverlayRowMain}>
                                <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>◆ {plan.name}</Text>
                                <Text style={[styles.dayOverlayAmount, { color: amount >= 0 ? c.success : "#3b82f6" }]}>{amount >= 0 ? "+" : "-"}${Math.abs(amount).toFixed(2)}</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => handleDeletePlan(plan)}
                                hitSlop={8}
                                style={({ pressed }) => [styles.dayOverlayDeleteButton, { backgroundColor: c.destructive + "12", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="trash-2" size={14} color={c.destructive} />
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {plannedExpenseGroupsForSelectedDay.length > 0 || displayedTxs.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Activity</Text>
                        {plannedExpenseGroupsForSelectedDay.map(group => {
                          const statusColor = group.closed ? c.success : c.warning;
                          const finalLabel = group.closed ? "Released" : "Left";
                          const finalAmount = group.closed ? group.releasedAmount : group.remainingAmount;
                          return (
                            <View
                              key={`overlay-bucket-${group.key}`}
                              style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: statusColor + "40" }]}
                            >
                              <View style={styles.dayBillTop}>
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{group.name}</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillMeta, { color: c.mutedForeground }]}>
                                    Spending bucket · {group.transactionIds.length} matched charge{group.transactionIds.length === 1 ? "" : "s"}
                                  </Text>
                                </View>
                                <View style={[styles.dayTransactionBadge, { backgroundColor: statusColor + "20" }]}>
                                  <Text style={[styles.dayTransactionBadgeText, { color: statusColor }]}>{group.closed ? "CLOSED" : "PARTIAL"}</Text>
                                </View>
                              </View>

                              <View style={styles.dayBillNumbers}>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Planned</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: c.foreground }]}>${group.plannedAmount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Spent</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: c.success }]}>${group.spentAmount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>{finalLabel}</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: statusColor }]}>${finalAmount.toFixed(2)}</Text>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                        {displayedTxs.map(tx => {
                          const sourceLabel = isConfirmedBillMatch(tx)
                            ? "Bill payment"
                            : tx.review_resolution === "income"
                              ? "Income received"
                              : tx.review_resolution === "goal" || tx.review_resolution === "decision"
                                ? "Planned spending"
                                : tx.review_resolution === "category"
                                  ? "Reviewed spending"
                            : tx.source === "plaid"
                            ? "Bank sync"
                            : tx.import_hash
                              ? "Imported"
                              : tx.linked_bill_id
                                ? "Bill payment"
                                : "Manual";
                          const isMoneyIn = tx.amount > 0;
                          const isTransfer = tx.review_status === "transfer";
                          const matchedBillId = confirmedBillMatchId(tx);
                          const matchedBillName = matchedBillId ? bills.find(bill => bill.id === matchedBillId)?.name : undefined;
                          const displayName = transactionDisplayName(tx, matchedBillName);
                          const settlement = reviewSettlementSummary(tx);
                          const partialAllocations = (tx.review_allocations ?? []).filter(allocation => allocation.settlement === "partial");
                          const aggregatedRemaining = partialAllocations.reduce((sum, allocation) => {
                            if (!allocation.targetId || !allocation.occurrenceDate) {
                              return sum + Math.max(0, Number(allocation.plannedAmount ?? allocation.amount) - Number(allocation.amount));
                            }
                            const aggregate = allocation.type === "bill"
                              ? billOccurrenceMatches.get(occurrenceKey(allocation.targetId, allocation.occurrenceDate))
                              : allocation.type === "income"
                                ? incomeOccurrenceMatches.get(occurrenceKey(allocation.targetId, allocation.occurrenceDate))
                                : undefined;
                            if (!aggregate) return sum + Math.max(0, Number(allocation.plannedAmount ?? allocation.amount) - Number(allocation.amount));
                            return sum + Math.max(0, Number(aggregate.plannedAmount ?? allocation.plannedAmount ?? aggregate.amount) - Number(aggregate.amount));
                          }, 0);
                          const remaining = Math.round((partialAllocations.length > 0 ? aggregatedRemaining : settlement.remaining) * 100) / 100;
                          const statusColor = isTransfer ? c.primary : remaining > 0.005 ? c.warning : c.success;
                          const statusLabel = isTransfer ? "TRANSFER" : remaining > 0.005 ? "PARTIAL" : isMoneyIn ? "RECEIVED" : "PAID";
                          return (
                            <View
                              key={`overlay-tx-${tx.id}`}
                              style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: statusColor + "40" }]}
                            >
                              <View style={styles.dayBillTop}>
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{displayName}</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillMeta, { color: c.mutedForeground }]}>
                                    {tx.category} · {sourceLabel}
                                  </Text>
                                </View>
                                <View style={[styles.dayTransactionBadge, { backgroundColor: statusColor + "20" }]}>
                                  <Text style={[styles.dayTransactionBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                                </View>
                              </View>

                              <View style={styles.dayBillNumbers}>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Amount</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: c.foreground }]}>${settlement.amount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>{isTransfer ? "Moved" : isMoneyIn ? "Received" : "Paid"}</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: c.success }]}>${settlement.paid.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
                                  <Text numberOfLines={1} style={[styles.dayBillNumberValue, { color: remaining > 0.005 ? c.warning : c.success }]}>${remaining.toFixed(2)}</Text>
                                </View>
                              </View>

                              <View style={styles.dayBillActions}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Edit ${displayName}`}
                                  onPress={() => openEditTransaction(tx)}
                                  style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                                >
                                  <Feather name="edit-2" size={13} color={c.primary} />
                                  <Text style={[styles.dayBillActionText, { color: c.primary }]}>Edit</Text>
                                </Pressable>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Delete ${displayName}`}
                                  onPress={() => handleDeleteTx(tx.id)}
                                  style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                                >
                                  <Feather name="trash-2" size={13} color={c.destructive} />
                                  <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Delete</Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {selectedDayItemCount === 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlayEmptyTitle, { color: c.foreground }]}>No activity</Text>
                        <Text style={[styles.dayOverlayEmptyText, { color: c.mutedForeground }]}>Add a transaction or plan for this day.</Text>
                      </View>
                    ) : null}
                  </ScrollView>

                  <View style={styles.dayOverlayActions}>
                    <Pressable
                      onPress={() => {
                        if (!selectedDate) return;
                        const date = selectedDate;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedDate(null);
                        const dayLabel = formatLongDate(date);
                        router.push({
                          pathname: "/(tabs)/flo",
                          params: {
                            prompt: buildDayForecastFloPrompt(dayLabel, date, selectedForecastDay?.balance, selectedForecastGroups),
                            promptId: `${date}-${Date.now()}`,
                          },
                        } as never);
                      }}
                      style={({ pressed }) => [styles.dayOverlayAskPill, { backgroundColor: c.primary + "16", borderColor: c.primary + "40", opacity: pressed ? 0.8 : 1 }]}
                    >
                      <Feather name="message-circle" size={16} color={c.primary} />
                      <Text style={[styles.dayOverlayAskText, { color: c.primary }]}>Ask Flo</Text>
                    </Pressable>
                    <CommandPlusButton
                      onPress={() => openAddTransaction(selectedDate)}
                      size={62}
                      iconSize={26}
                      accessibilityLabel="Add on selected day"
                    />
                  </View>
                </Pressable>
              </Pressable>
            </Modal>

          </View>
        </View>
      )}

      <Modal
        visible={monthSearchVisible}
        animationType="fade"
        transparent
        onRequestClose={closeMonthSearch}
      >
        <Pressable style={styles.monthSearchBackdrop} onPress={closeMonthSearch}>
          <Pressable
            onPress={event => event.stopPropagation()}
            style={[
              styles.monthSearchSheet,
              {
                backgroundColor: c.isDark ? "rgba(15,23,42,0.98)" : "rgba(255,255,255,0.98)",
                borderColor: c.border,
              },
            ]}
          >
            <View style={styles.monthSearchHeader}>
              <View>
                <Text style={[styles.monthSearchEyebrow, { color: c.primary }]}>Calendar search</Text>
                <Text style={[styles.monthSearchTitle, { color: c.foreground }]}>Jump to month</Text>
              </View>
              <Pressable
                onPress={closeMonthSearch}
                hitSlop={10}
                style={({ pressed }) => [styles.monthSearchClose, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>

            <View style={[styles.monthSearchInputWrap, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="search" size={18} color={c.mutedForeground} />
              <TextInput
                value={monthSearchQuery}
                onChangeText={setMonthSearchQuery}
                placeholder="Search month..."
                placeholderTextColor={c.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.monthSearchInput, { color: c.foreground }]}
              />
              {monthSearchQuery.length > 0 && (
                <Pressable onPress={() => setMonthSearchQuery("")} hitSlop={8}>
                  <Feather name="x-circle" size={18} color={c.mutedForeground} />
                </Pressable>
              )}
            </View>

            <View style={styles.monthSearchYearRow}>
              <Pressable
                onPress={() => changeSearchYear(-1)}
                style={({ pressed }) => [styles.monthSearchYearButton, { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="chevron-left" size={18} color={c.foreground} />
              </Pressable>
              <Text style={[styles.monthSearchYearText, { color: c.foreground }]}>{selectedYear}</Text>
              <Pressable
                onPress={() => changeSearchYear(1)}
                style={({ pressed }) => [styles.monthSearchYearButton, { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="chevron-right" size={18} color={c.foreground} />
              </Pressable>
            </View>

            <View style={styles.monthSearchGrid}>
              {monthSearchOptions.map(option => {
                const selected = option.index === month;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => chooseMonthFromSearch(option.index)}
                    style={({ pressed }) => [
                      styles.monthSearchOption,
                      {
                        backgroundColor: selected ? c.primary : c.card,
                        borderColor: selected ? c.primary : c.border,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.monthSearchOptionShort, { color: selected ? c.primaryForeground : c.foreground }]}>
                      {option.short}
                    </Text>
                    <Text style={[styles.monthSearchOptionName, { color: selected ? c.primaryForeground : c.mutedForeground }]}>
                      {option.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Due-day reschedule picker ── */}
      <Modal
        visible={dueDayPicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDueDayPicker(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setDueDayPicker(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            {dueDayPicker && (() => {
              const { bill, fromDate } = dueDayPicker;
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const movedDate = getBillDateMoveForOccurrence(bill.id, fromDate)?.to_date;
              const effectiveDate = movedDate ?? fromDate;
              const effectiveDay = dayFromIsoDate(effectiveDate);
              const originalDay = dayFromIsoDate(fromDate);
              return (
                <>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <View>
                      <Text style={[styles.pickerTitle, { color: c.foreground }]}>{bill.name}</Text>
                      <Text style={[styles.pickerSub, { color: c.mutedForeground }]}>
                        Currently {formatShortDate(effectiveDate)}
                        {movedDate ? ` · moved from ${formatShortDate(fromDate)}` : " · original date"}
                      </Text>
                    </View>
                    <Pressable onPress={() => setDueDayPicker(null)} hitSlop={8}>
                      <Feather name="x" size={20} color={c.mutedForeground} />
                    </Pressable>
                  </View>

                  <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>
                    Select the new due day for this month only
                  </Text>

                  {/* Day-of-week headers */}
                  <View style={styles.pickerCalDowRow}>
                    {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                      <Text key={d} style={[styles.pickerCalDowLabel, { color: c.mutedForeground }]}>{d}</Text>
                    ))}
                  </View>

                  {/* Calendar grid — days aligned to correct weekday column */}
                  <View style={styles.pickerDayGrid}>
                    {[
                      ...Array(new Date(selectedYear, month, 1).getDay()).fill(null),
                      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                    ].map((day, idx) => {
                      if (day === null) return <View key={`e${idx}`} style={styles.pickerDayBtn} />;
                      const isCurrent = day === effectiveDay;
                      const isOriginal = day === originalDay && !movedDate;
                      return (
                        <Pressable
                          key={day}
                          disabled={savingDueDay}
                          onPress={() => saveDueDayChange(dueDayPicker, day)}
                          style={({ pressed }) => [
                            styles.pickerDayBtn,
                            {
                              backgroundColor: isCurrent ? c.primary : isOriginal ? c.primary + "25" : c.muted,
                              opacity: pressed ? 0.7 : 1,
                              borderRadius: 8,
                            },
                          ]}
                        >
                          <Text style={[
                            styles.pickerDayText,
                            { color: isCurrent ? c.primaryForeground : c.foreground },
                          ]}>
                            {day}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {movedDate && (
                    <Pressable
                      disabled={savingDueDay}
                      onPress={() => saveDueDayChange(dueDayPicker, undefined)}
                      style={({ pressed }) => [
                        styles.pickerResetBtn,
                        { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1, borderRadius: colors.radius },
                      ]}
                    >
                      <Feather name="rotate-ccw" size={14} color={c.mutedForeground} />
                      <Text style={[styles.pickerResetText, { color: c.mutedForeground }]}>
                        Reset to {formatShortDate(fromDate)}
                      </Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={incomeDatePicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setIncomeDatePicker(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setIncomeDatePicker(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            {incomeDatePicker && (() => {
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const effectiveDay = incomeDatePicker.day;
              return (
                <>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <View>
                      <Text style={[styles.pickerTitle, { color: c.foreground }]}>{incomeDatePicker.income.name}</Text>
                      <Text style={[styles.pickerSub, { color: c.mutedForeground }]}>
                        {MONTH_FULL[month]} {selectedYear} · Currently {MONTH_FULL[month]} {effectiveDay}, {selectedYear}
                      </Text>
                    </View>
                    <Pressable onPress={() => setIncomeDatePicker(null)} hitSlop={8}>
                      <Feather name="x" size={20} color={c.mutedForeground} />
                    </Pressable>
                  </View>

                  <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>
                    Select the new payday for this income schedule
                  </Text>

                  <View style={styles.pickerCalDowRow}>
                    {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                      <Text key={d} style={[styles.pickerCalDowLabel, { color: c.mutedForeground }]}>{d}</Text>
                    ))}
                  </View>

                  <View style={styles.pickerDayGrid}>
                    {[
                      ...Array(new Date(selectedYear, month, 1).getDay()).fill(null),
                      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                    ].map((day, idx) => {
                      if (day === null) return <View key={`income-empty-${idx}`} style={styles.pickerDayBtn} />;
                      const isCurrent = day === effectiveDay;
                      return (
                        <Pressable
                          key={day}
                          disabled={savingIncomeDate}
                          onPress={() => saveIncomeDateChange(incomeDatePicker.income, day)}
                          style={({ pressed }) => [
                            styles.pickerDayBtn,
                            {
                              backgroundColor: isCurrent ? c.primary : c.muted,
                              opacity: pressed ? 0.7 : 1,
                              borderRadius: 8,
                            },
                          ]}
                        >
                          <Text style={[styles.pickerDayText, { color: isCurrent ? c.primaryForeground : c.foreground }]}>
                            {day}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      <AddTransactionModal
        visible={txModalVisible}
        onClose={() => { setTxModalVisible(false); setEditTx(null); setTransactionDefaultDate(undefined); }}
        onSave={async (data) => {
          if (editTx && "id" in data) {
            await updateTransaction(data as Transaction);
            showTransactionDebtNotice(data);
          } else {
            const newTx = data as Omit<Transaction, "id">;
            await addTransaction(newTx);
            checkForRecurring(newTx);
            showTransactionDebtNotice(newTx);
          }
        }}
        editTx={editTx}
        defaultDate={editTx ? undefined : transactionDefaultDate}
      />
      <DebtPaymentAppliedModal
        visible={!!debtPaymentNotice}
        detail={debtPaymentNotice}
        onClose={() => setDebtPaymentNotice(null)}
      />
      <Modal
        visible={monthSummaryDetail !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setMonthSummaryDetail(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setMonthSummaryDetail(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerTitle, { color: c.foreground }]}>{monthSummaryDetail?.title ?? "Month detail"}</Text>
                <Text style={[styles.monthDetailTotal, { color: c.primary }]}>Total: {monthSummaryDetail?.value ?? "$0"}</Text>
              </View>
              <Pressable onPress={() => setMonthSummaryDetail(null)} hitSlop={8}>
                <Feather name="x" size={20} color={c.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView style={styles.monthDetailList} showsVerticalScrollIndicator={false}>
              {(monthSummaryDetail?.details.length ? monthSummaryDetail.details : [monthSummaryDetail?.fallback ?? "No details available."]).map((detail, index) => (
                <View key={`${detail}-${index}`} style={[styles.monthDetailRow, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={[styles.monthDetailDot, { backgroundColor: c.primary }]} />
                  <Text style={[styles.monthDetailText, { color: c.foreground }]}>{detail}</Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={editPlan !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditPlan(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setEditPlan(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <View>
                <Text style={[styles.pickerTitle, { color: c.foreground }]}>Edit Plan</Text>
                <Text style={[styles.pickerSub, { color: c.mutedForeground }]}>
                  {editPlanDate} · updates your forecast
                </Text>
              </View>
              <Pressable onPress={() => setEditPlan(null)} hitSlop={8}>
                <Feather name="x" size={20} color={c.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>Name</Text>
            <TextInput
              value={editPlanName}
              onChangeText={setEditPlanName}
              placeholder="Plan name"
              placeholderTextColor={c.mutedForeground}
              style={[styles.planInput, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
            />

            <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>Plan Date</Text>
            <View style={styles.pickerCalDowRow}>
              {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                <Text key={d} style={[styles.pickerCalDowLabel, { color: c.mutedForeground }]}>{d}</Text>
              ))}
            </View>
            <View style={styles.pickerDayGrid}>
              {[
                ...Array(new Date(selectedYear, month, 1).getDay()).fill(null),
                ...Array.from({ length: new Date(selectedYear, month + 1, 0).getDate() }, (_, i) => i + 1),
              ].map((day, idx) => {
                if (day === null) return <View key={`plan-empty-${idx}`} style={styles.pickerDayBtn} />;
                const date = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const isSelectedPlanDate = editPlanDate === date;
                return (
                  <Pressable
                    key={`plan-day-${day}`}
                    onPress={() => setEditPlanDate(date)}
                    style={({ pressed }) => [
                      styles.pickerDayBtn,
                      {
                        backgroundColor: isSelectedPlanDate ? c.primary : c.muted,
                        opacity: pressed ? 0.7 : 1,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.pickerDayText,
                      { color: isSelectedPlanDate ? c.primaryForeground : c.foreground },
                    ]}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.pickerLabel, { color: c.mutedForeground }]}>Amount</Text>
            <TextInput
              value={editPlanAmount}
              onChangeText={setEditPlanAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={c.mutedForeground}
              style={[styles.planInput, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }]}
            />

            <Pressable
              disabled={savingPlan}
              onPress={saveEditedPlan}
              style={({ pressed }) => [
                styles.planSaveBtn,
                { backgroundColor: c.primary, opacity: pressed || savingPlan ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.planSaveText, { color: c.primaryForeground }]}>
                {savingPlan ? "Saving..." : "Save Plan"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <SnowballPreviewModal
        visible={settings.debtPayoffEnabled && snowballModalVisible}
        method={settings.paymentMethod}
        preview={snowballPreview}
        amount={extraPayment}
        existingPayment={!!getExtraPayment(month, selectedYear)}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        onAmountChange={updateSnowballAmount}
        onClose={() => setSnowballModalVisible(false)}
        onConfirm={confirmSnowballPayment}
        onRemove={() => removeDebtSnowballPayment(month, selectedYear).then(() => setSnowballModalVisible(false))}
      />
      <FullPaymentPromptModal
        visible={!!fullPaymentPrompt}
        prompt={fullPaymentPrompt ? {
          billName: fullPaymentPrompt.bill.name,
          budgeted: fullPaymentPrompt.budgeted,
          actual: fullPaymentPrompt.actual,
        } : null}
        onClose={closeFullPaymentPrompt}
        onKeepPartial={keepPromptAsPartialPayment}
        onFullPayment={confirmPromptAsFullPayment}
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
        paymentDateMin={`${selectedYear}-${String(month + 1).padStart(2, "0")}-01`}
        paymentDateMax={`${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(new Date(selectedYear, month + 1, 0).getDate()).padStart(2, "0")}`}
        onPaymentDateChange={setSurplusPaymentDate}
        onKeep={keepBillSurplus}
        onSnowball={addBillSurplusToSnowball}
        onClose={() => setSurplusPrompt(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingBottom: 10 },
  calendarBrand: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.2, marginBottom: 3, textTransform: "uppercase" },
  calendarScreenLabel: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },
  title: { fontSize: 36, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.2, textShadowColor: "rgba(34,211,238,0.22)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  forecastTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  todayChip: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  todayChipText: { fontSize: 17, fontFamily: "Inter_800ExtraBold", lineHeight: 20 },
  iconBtn: { width: 54, height: 54, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#8b5cf6", shadowOpacity: 0.46, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 10, borderWidth: 1, borderColor: "rgba(34,211,238,0.28)" },
  calendarMonthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 22, marginTop: 0, marginBottom: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(2,6,23,0.32)", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 10 },
  monthArrowBtn: { width: 46, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "rgba(15,23,42,0.58)" },
  monthCenterLabel: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  monthCenterPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  monthTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  monthShortTitle: { fontSize: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.8 },
  monthSwipeHint: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },
  monthSearchBackdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", justifyContent: "center", paddingHorizontal: 22 },
  monthSearchSheet: { borderWidth: 1, borderRadius: 28, padding: 18, shadowColor: "#8b5cf6", shadowOpacity: 0.32, shadowRadius: 26, shadowOffset: { width: 0, height: 12 }, elevation: 18 },
  monthSearchHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  monthSearchEyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.7, textTransform: "uppercase", marginBottom: 4 },
  monthSearchTitle: { fontSize: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5 },
  monthSearchClose: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  monthSearchInputWrap: { minHeight: 52, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  monthSearchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", paddingVertical: Platform.OS === "web" ? 10 : 8 },
  monthSearchYearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 },
  monthSearchYearButton: { width: 42, height: 36, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  monthSearchYearText: { minWidth: 72, textAlign: "center", fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  monthSearchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  monthSearchOption: { width: "30.9%", minHeight: 72, borderRadius: 18, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 10, justifyContent: "center" },
  monthSearchOptionShort: { fontSize: 18, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  monthSearchOptionName: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  tabBar: { flexDirection: "row", padding: 4, gap: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", padding: 12 },
  zeroBudgetMonthlyLink: { marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  zeroBudgetMonthlyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  zeroBudgetMonthlyTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  zeroBudgetMonthlyText: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  summaryValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sep: { width: 1 },
  cfBar: { paddingHorizontal: 14, paddingVertical: 10 },
  cfBarInner: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cfLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cfValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  extraCard: { padding: 12 },
  extraHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  extraTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  extraRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  extraInput: { flex: 1, height: 36, borderRadius: 8, paddingHorizontal: 12, fontSize: 13, fontFamily: "Inter_400Regular" },
  applyBtn: { paddingHorizontal: 14, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  applyBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  resultsBox: { marginTop: 10, padding: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  resultText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  dismissBtn: { marginTop: 8, alignItems: "center" },
  dismissText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  billFilterRow: { flexDirection: "row", gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { paddingHorizontal: 16, paddingTop: 6 },
  entryCard: { marginBottom: 12, borderLeftWidth: 4, borderWidth: 1, borderColor: "rgba(148,163,184,0.10)", shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 12, paddingBottom: 6 },
  entryLeft: { flex: 1 },
  entryName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  entryMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  entryRight: { alignItems: "flex-end" },
  quickPaidBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  quickPaidText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amtRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  amtField: { flex: 1 },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  fieldInput: { height: 34, borderRadius: 7, paddingHorizontal: 9, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  leftBox: { height: 34, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  leftText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  debtNote: { marginHorizontal: 12, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  debtNoteText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  dueDayRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginBottom: 10 },
  dueDayInput: { width: 42, height: 30, borderRadius: 6, textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold", borderWidth: 1 },
  calScroll: { paddingTop: 8 },
  calFixed: { flex: 1, paddingTop: 8 },
  calInner: { flex: 1, paddingHorizontal: 12 },
  weeklyChip: { flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 12, marginTop: 2, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  weeklyChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  balanceBar: { flexDirection: "row", padding: 12, marginBottom: 0 },
  balanceBarItem: { flex: 1, alignItems: "center" },
  balanceBarLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  balanceBarValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  monthControlCard: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 },
  monthControlHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  monthControlTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  monthControlSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  monthControlBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  monthControlBadgeText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  monthSummaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthSummaryTile: { width: "48.5%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, minHeight: 58, justifyContent: "center" },
  monthSummaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.55, marginBottom: 4 },
  monthSummaryValue: { fontSize: 16, fontFamily: "Inter_800ExtraBold" },
  monthWatchCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  monthWatchHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  monthWatchTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  monthWatchText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  askFloFixButton: { marginTop: 10, minHeight: 42, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  askFloFixText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  txSummary: { flexDirection: "row", padding: 12, marginBottom: 10 },
  txSumItem: { flex: 1, alignItems: "center" },
  txSumLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  txSumValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  txListHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 },
  lowBalanceCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  lowBalanceTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  lowBalanceText: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },
  forecastExplanation: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  forecastExplanationHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  forecastExplanationTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  forecastExplanationSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  forecastGroup: { paddingTop: 6 },
  forecastGroupTitle: { fontSize: 11, fontFamily: "Inter_700Bold", marginBottom: 2 },
  forecastSourceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 5 },
  forecastSourceName: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular" },
  forecastSourceAmount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dayOverlayBackdrop: { flex: 1, justifyContent: "center", padding: 18, backgroundColor: "rgba(0,0,0,0.64)" },
  dayOverlayCard: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 30,
    padding: 18,
    maxHeight: "82%",
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  dayOverlayHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  dayOverlayDateBlock: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  dayOverlayBigDay: { fontSize: 34, fontFamily: "Inter_700Bold", lineHeight: 40 },
  dayOverlayTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  dayOverlaySub: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  dayOverlayScroll: { maxHeight: 470 },
  dayOverlayScrollContent: { gap: 10, paddingBottom: 8 },
  dayOverlayRisk: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 16, padding: 12 },
  dayOverlayRiskText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  dayOverlaySection: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  dayOverlaySectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  dayOverlayGroup: { gap: 5 },
  dayOverlayGroupTitle: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6 },
  dayOverlayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 30 },
  dayOverlayRowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  dayOverlayDeleteButton: { width: 30, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  dayOverlayRowName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dayOverlayAmount: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dayBillCard: { borderWidth: 1, borderRadius: 16, padding: 11, gap: 10 },
  dayBillTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dayBillName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  dayBillMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  dayBillNumbers: { flexDirection: "row", gap: 8 },
  dayBillNumberTile: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 8 },
  dayBillNumberLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  dayBillNumberValue: { fontSize: 13, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  dayDebtPlanSummary: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  dayDebtPlanText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dayDebtPlanTotal: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  dayDebtPlanNote: { fontSize: 10, fontFamily: "Inter_500Medium" },
  dayTransactionBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
  dayTransactionBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.45 },
  dayBillPaidTile: { borderWidth: 1 },
  dayBillPaidInputRow: { flexDirection: "row", alignItems: "center", marginTop: 1 },
  dayBillPaidDollar: { fontSize: 13, fontFamily: "Inter_800ExtraBold", marginRight: 1 },
  dayBillPaidInput: { flex: 1, minWidth: 42, paddingHorizontal: 0, paddingVertical: 0, fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  dayBillPaidSave: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  dayBillActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayBillAction: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  dayBillActionText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  dayOverlayEmptyTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dayOverlayEmptyText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dayOverlayActions: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14 },
  dayOverlayAskPill: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 25, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, flexDirection: "row", gap: 6 },
  dayOverlayAskText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  dayOverlayFab: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  txListTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginHorizontal: 16, marginTop: 10, marginBottom: 4 },
  txRow: { flexDirection: "row", alignItems: "center", marginBottom: 7, overflow: "hidden" },
  txMain: { flex: 1, flexDirection: "row", alignItems: "center", padding: 11 },
  txIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", marginRight: 10 },
  txBody: { flex: 1 },
  txNote: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  txDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  txRescheduleHint: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  txMovedHint: { fontSize: 10, fontFamily: "Inter_700Bold", marginTop: 2 },
  txAmt: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 8 },
  txDelete: { paddingHorizontal: 14, paddingVertical: 11 },
  restoreMoveButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, marginLeft: 8 },
  restoreMoveText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#555", alignSelf: "center", marginBottom: 16 },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  pickerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  pickerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  monthDetailTotal: { fontSize: 22, fontFamily: "Inter_800ExtraBold", marginTop: 6 },
  monthDetailList: { maxHeight: 360 },
  monthDetailRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  monthDetailDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  monthDetailText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  pickerLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  pickerCalDowRow: { flexDirection: "row", marginBottom: 4 },
  pickerCalDowLabel: { width: "14.285714%", textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  pickerDayGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 16 },
  pickerDayBtn: { width: "14.285714%", height: 44, alignItems: "center", justifyContent: "center" },
  pickerDayText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pickerResetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  pickerResetText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  planInput: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  planSaveBtn: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  planSaveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  incomeCard: { paddingTop: 12, paddingBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  incomeHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, marginBottom: 10 },
  incomeTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  incomeTotalText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  incomeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  incomeDayBadge: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  incomeDayNum: { fontSize: 14, fontFamily: "Inter_700Bold" },
  incomeName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  incomeAmt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { EmptyState } from "@/components/EmptyState";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { SnowballPreviewModal } from "@/components/SnowballPreviewModal";
import colors from "@/constants/colors";
import type { Bill, BillDateMove, DecisionRecord, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { evaluateDecision, scenarioDates } from "@/lib/decisions";
import { buildDayForecastFloPrompt, groupForecastEvents } from "@/lib/forecastDisplay";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import type { SnowballProjectionResult } from "@/lib/snowball";
import { isValidDateInMonth } from "@/lib/schedule";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type TabView = "bills" | "calendar";

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function money(amount: number, sign: "auto" | "none" = "none") {
  const prefix = sign === "auto" && amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${prefix}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function debtSurplusTransactionImportHash(sourceDebtId: string, month: number, year: number) {
  return `flowledger:debt-surplus:${sourceDebtId}:${year}-${String(month + 1).padStart(2, "0")}`;
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
  const {
    bills, overrides, billDateMoves, transactions, goals, decisions, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
    getCustomDueDay, setCustomDueDay,
    removeBillOccurrenceMove, getBillDateMoveForOccurrence,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction, addBill,
    getCashFlow, getMonthlyIncome, getDailyBalances, getIncomeOccurrencesInMonth,
    previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment, finalizeBillPayment, getExtraPayment,
    updateDecision, deleteDecision,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab] = useState<TabView>("calendar");
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [transactionDefaultDate, setTransactionDefaultDate] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingAmounts, setEditingAmounts] = useState<Record<string, string>>({});
  const [editingPaid, setEditingPaid] = useState<Record<string, string>>({});
  const editingPaidRef = useRef<Record<string, string>>({});
  const [billFilter, setBillFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [extraPayment, setExtraPayment] = useState("");
  const [snowballResults, setSnowballResults] = useState<{ name: string; payment: number; paidOff: boolean }[]>([]);
  const [showSnowballResults, setShowSnowballResults] = useState(false);
  const [dueDayPickerBill, setDueDayPickerBill] = useState<Bill | null>(null);
  const [savingDueDay, setSavingDueDay] = useState(false);
  const [snowballModalVisible, setSnowballModalVisible] = useState(false);
  const [snowballPreview, setSnowballPreview] = useState<SnowballProjectionResult | null>(null);
  const [surplusPrompt, setSurplusPrompt] = useState<{ bill: Bill; budgeted: number; actual: number; paidDate: string } | null>(null);
  const [surplusPaymentDate, setSurplusPaymentDate] = useState("");
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

  useBackDismiss(txModalVisible, () => {
    setTxModalVisible(false);
    setEditTx(null);
    setTransactionDefaultDate(undefined);
  });
  useBackDismiss(Boolean(dueDayPickerBill), () => setDueDayPickerBill(null));
  useBackDismiss(Boolean(monthSummaryDetail), () => setMonthSummaryDetail(null));
  useBackDismiss(Boolean(editPlan), () => setEditPlan(null));
  useBackDismiss(showSnowballResults, () => setShowSnowballResults(false));

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

  useEffect(() => {
    const closeTopOverlay = () => {
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
        setDueDayPickerBill(null);
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
  }, [dueDayPickerBill, editPlan, monthSummaryDetail, selectedDate, showSnowballResults, snowballModalVisible, snowballPreview, surplusPrompt, txModalVisible]);

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
  const dailyBalances = useMemo(() => getDailyBalances(month, selectedYear), [getDailyBalances, month, selectedYear]);
  const incomeOccurrences = useMemo(() => {
    const occurrences = getIncomeOccurrencesInMonth(month, selectedYear);
    const flat: { day: number; name: string; amount: number; frequency: string; incomeId: string }[] = [];
    occurrences.forEach(({ income: inc, days, effectiveAmount }) => {
      days.forEach(day => flat.push({ day, name: inc.name, amount: effectiveAmount, frequency: inc.frequency, incomeId: inc.id }));
    });
    return flat.sort((a, b) => a.day - b.day);
  }, [getIncomeOccurrencesInMonth, month, selectedYear]);
  const txIncome = txList.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const txExpense = txList.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
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
          ...txList.filter(tx => tx.amount > 0).slice(0, 10).map(tx => `${formatShortDate(tx.date)}: ${tx.note || tx.category} ${money(tx.amount, "auto")}`),
        ],
        bills: detailsFor(event => event.sourceType === "bill" || event.kind === "bill"),
        transactions: txList.slice(0, 10).map(tx => `${formatShortDate(tx.date)}: ${tx.note || tx.category} ${money(tx.amount, "auto")}`),
        planned: detailsFor(event => event.sourceType === "decision"),
        debtExtras: detailsFor(event => event.sourceType === "extra_payment" || event.kind === "debt_payment"),
      },
    };
  }, [dailyBalances, month, settings.starting_balance, txIncome, txExpense, txList]);

  const monthWatchInsight = useMemo(() => {
    if (!monthSummary.lowestDay || monthSummary.lowest >= settings.safety_floor) return null;
    const eventsBeforeLow = dailyBalances
      .filter(day => day.day <= (monthSummary.lowestDay ?? 0))
      .flatMap(day => (day.events ?? []).map(event => ({ ...event, day: day.day })));
    const biggestOutflows = eventsBeforeLow
      .filter(event => event.amount < -0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 3)
      .map(event => `${event.name || event.kind} ${money(event.amount, "auto")} on ${MONTH_FULL[month].slice(0, 3)} ${event.day}`);
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

  const scheduledBillsForDay = useMemo(() => {
    if (selectedDay === null) return [];
    return monthBills.filter(b => getBillOccurrencesInMonth(b, month, selectedYear).includes(selectedDay));
  }, [monthBills, getBillOccurrencesInMonth, selectedDay, month, selectedYear]);

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

  const isFuture = useMemo(() => {
    const now = new Date();
    return selectedYear > now.getFullYear() || (selectedYear === now.getFullYear() && month > now.getMonth());
  }, [month, selectedYear]);

  const cashFlow = useMemo(() => getCashFlow(month, selectedYear), [getCashFlow, month, selectedYear]);
  const monthlyIncome = getMonthlyIncome();

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt) return null;
    const surplus = Math.max(0, surplusPrompt.budgeted - surplusPrompt.actual);
    const existing = getExtraPayment(month, selectedYear);
    const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id)?.amount ?? 0;
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + surplus);
    const validDate = isValidDateInMonth(surplusPaymentDate, month, selectedYear);
    const preview = previewDebtSnowball(month, selectedYear, total, surplus - previousSource, validDate ? surplusPaymentDate : undefined);
    return { preview, total, targetDebt: preview.months[0]?.targetName ?? preview.allocations[0]?.billName, dateValid: validDate, safe: validDate && preview.selectedExtra + 0.005 >= total };
  }, [surplusPrompt, surplusPaymentDate, getExtraPayment, previewDebtSnowball, month, selectedYear]);

  const handlePaidBlur = useCallback(async (billId: string, key: string, submittedValue?: string) => {
    if (savingPaidKey === key) return;
    const val = submittedValue ?? editingPaidRef.current[key] ?? editingPaid[key];
    if (val === undefined) return;
    const trimmed = val.trim();
    const clearPaidEdit = () => {
      editingPaidRef.current = { ...editingPaidRef.current };
      delete editingPaidRef.current[key];
      setEditingPaid(p => { const n = { ...p }; delete n[key]; return n; });
    };
    clearPaidEdit();
    setSavingPaidKey(key);
    try {
      const bill = bills.find(item => item.id === billId);
      if (trimmed.length === 0) {
        if (bill?.is_debt) {
          const key = `flowledger:debt-surplus:${bill.id}:${selectedYear}-${String(month + 1).padStart(2, "0")}`;
          const existingTx = transactions.find(transaction => transaction.import_hash === key);
          if (existingTx) await deleteTransaction(existingTx.id);
        }
        await setPaidAmount(billId, month, selectedYear, 0);
        return;
      }
      const parsed = parseFloat(trimmed);
      if (!Number.isFinite(parsed)) return;
      const budgeted = bill ? getBillMonthlyTotal(bill, month, selectedYear) : 0;
      const day = bill ? Math.min(new Date(selectedYear, month + 1, 0).getDate(), getCustomDueDay(bill.id, month, selectedYear) ?? bill.due_day) : 1;
      const paidDate = `${selectedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const existing = getExtraPayment(month, selectedYear);
      const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === billId);
      const newSurplus = Math.max(0, budgeted - parsed);

      if (bill && previousSource && newSurplus <= previousSource.amount + 0.005) {
        const sources = (existing?.sources ?? [])
          .filter(source => !(source.type === "bill_surplus" && source.billId === billId));
        if (newSurplus > 0.005) sources.push({ ...previousSource, amount: newSurplus });
        const total = sources.reduce((sum, source) => sum + source.amount, 0);
        const preview = previewDebtSnowball(month, selectedYear, total);
        if (bill.is_debt) await setPaidAmount(bill.id, month, selectedYear, parsed);
        else await finalizeBillPayment(bill.id, month, selectedYear, parsed, paidDate);
        if (total > 0.005) await applyDebtSnowballPayment(preview, sources);
        else await removeDebtSnowballPayment(month, selectedYear);
        return;
      }
      if (bill && parsed >= 0 && parsed < budgeted) {
        Keyboard.dismiss();
        setSurplusPrompt({ bill, budgeted, actual: parsed, paidDate });
        setSurplusPaymentDate(paidDate);
        setSelectedDate(null);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (bill && !bill.is_debt) await finalizeBillPayment(billId, month, selectedYear, parsed, paidDate);
      else await setPaidAmount(billId, month, selectedYear, parsed);
    } finally {
      setSavingPaidKey(current => current === key ? null : current);
    }
  }, [editingPaid, savingPaidKey, setPaidAmount, bills, overrides, transactions, deleteTransaction, getBillMonthlyTotal, getCustomDueDay, getExtraPayment, previewDebtSnowball, finalizeBillPayment, applyDebtSnowballPayment, removeDebtSnowballPayment, month, selectedYear]);

  const finalizeBillAtActualForMonth = useCallback(async (prompt: { bill: Bill; actual: number; paidDate: string }) => {
    if (prompt.bill.is_debt) {
      await setPaidAmount(prompt.bill.id, month, selectedYear, prompt.actual);
      await finalizeBillPayment(prompt.bill.id, month, selectedYear, prompt.actual, prompt.paidDate);
      return;
    }
    await finalizeBillPayment(prompt.bill.id, month, selectedYear, prompt.actual, prompt.paidDate);
    if (!prompt.bill.is_debt && prompt.bill.frequency === "monthly") {
      await setCustomAmount(
        prompt.bill.id,
        month,
        selectedYear,
        Math.abs(prompt.actual - prompt.bill.amount) < 0.005 ? undefined : prompt.actual,
      );
    }
  }, [finalizeBillPayment, month, selectedYear, setCustomAmount, setPaidAmount]);

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

  const keepBillSurplus = async () => {
    if (!surplusPrompt) return;
    if (surplusPrompt.bill.is_debt) {
      await finalizeBillAtActualForMonth(surplusPrompt);
      await removeDebtSurplusTransaction(surplusPrompt.bill.id);
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
    setSurplusPrompt(null);
  };

  const handleAmtBlur = useCallback((bill: { id: string; amount: number }, key: string) => {
    const val = editingAmounts[key];
    if (val === undefined) return;
    const parsed = parseFloat(val);
    setCustomAmount(bill.id, month, selectedYear, isNaN(parsed) || parsed === bill.amount ? undefined : parsed);
    setEditingAmounts(p => { const n = { ...p }; delete n[key]; return n; });
  }, [editingAmounts, setCustomAmount, month, selectedYear]);

  const saveDueDayChange = useCallback(async (bill: Bill, day: number | undefined) => {
    if (savingDueDay) return;
    setSavingDueDay(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await setCustomDueDay(bill.id, month, selectedYear, day);
      setDueDayPickerBill(null);
    } catch (error) {
      Alert.alert("Couldn’t save date", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingDueDay(false);
    }
  }, [savingDueDay, setCustomDueDay, month, selectedYear]);


  const handleQuickPaid = useCallback(async (billId: string, amount: number, isPaid: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPaid) await removeDebtSurplusTransaction(billId);
    await setPaidAmount(billId, month, selectedYear, isPaid ? 0 : amount);
  }, [setPaidAmount, removeDebtSurplusTransaction, month, selectedYear]);

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
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert(isTransfer ? "Delete Transfer" : "Delete Transaction", isTransfer ? "Remove both sides of this transfer?" : "Remove this transaction?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
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
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Remove Plan", `Remove "${decision.name}" from your calendar and forecast?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: doDelete },
    ]);
  };

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
              Alert.alert("Bill Added", `"${displayName}" has been added as a monthly recurring bill on ${MONTH_FULL[month].slice(0, 3)} ${dueDay}.`);
            },
          },
        ]
      );
    }
  }, [transactions, addBill]);

  const displayedTxs = selectedDate
    ? txList.filter(t => t.date === selectedDate)
    : [];
  const selectedForecastEventCount = selectedForecastGroups.reduce((sum, group) => sum + group.events.length, 0);
  const selectedVisibleItemCount = scheduledBillsForDay.length + displayedTxs.length + goalsForSelectedDay.length + plansForSelectedDay.length;
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

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <PremiumBackdrop variant="purple" />
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopPad }]}>
        <View>
          <Text style={[styles.calendarBrand, { color: c.primary }]}>FLOWLEDGER ALGO</Text>
          <Text style={[styles.title, { color: c.foreground }]}>{MONTH_FULL[month]} {selectedYear}</Text>
          {isFuture && <Text style={[styles.forecastTag, { color: c.primary }]}>Forecast Mode</Text>}
        </View>
        <Pressable
          onPress={() => openAddTransaction(selectedDate)}
          style={({ pressed }) => [styles.iconBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="plus" size={18} color={c.primaryForeground} />
        </Pressable>
      </View>

      <View style={styles.calendarMonthBar}>
        <Pressable
          onPress={() => changeMonth(-1)}
          hitSlop={10}
          style={({ pressed }) => [styles.monthArrowBtn, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Feather name="chevron-left" size={24} color={c.mutedForeground} />
        </Pressable>
        <View style={styles.monthCenterLabel}>
          <Text style={[styles.monthShortTitle, { color: c.foreground }]}>{MONTH_FULL[month].slice(0, 3).toUpperCase()}</Text>
          <Text style={[styles.monthSwipeHint, { color: c.mutedForeground }]}>Month view · swipe left or right</Text>
        </View>
        <Pressable
          onPress={() => changeMonth(1)}
          hitSlop={10}
          style={({ pressed }) => [styles.monthArrowBtn, { opacity: pressed ? 0.55 : 1 }]}
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

                <View style={[styles.extraCard, { backgroundColor: c.card, marginHorizontal: 16, borderRadius: colors.radius, marginTop: 8 }]}>
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
                </View>

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
                          : `Due ${MONTH_FULL[month].slice(0, 3)} ${effectiveDueDay}${customDay !== undefined ? " *" : ""} · ${bill.category}`}
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
                        onChangeText={v => setEditingPaid(p => ({ ...p, [paidKey]: v }))}
                        onFocus={() => setEditingPaid(p => ({ ...p, [paidKey]: paid > 0 ? paid.toFixed(2) : "" }))}
                        onBlur={() => handlePaidBlur(bill.id, paidKey)}
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
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDueDayPickerBill(bill); }}
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
                          onPress={() => saveDueDayChange(bill, undefined)}
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
        <View style={[styles.calFixed, { paddingBottom: insets.bottom + 64 }]}>
          <View style={styles.calInner}>
            <View {...calendarSwipeResponder.panHandlers}>
              <CalendarView
                month={month}
                year={selectedYear}
                transactions={txList}
                selectedDate={selectedDate}
                onDayPress={(date) => setSelectedDate(date)}
                dailyBalances={dailyBalances}
                goals={goals}
                decisions={decisions}
                safetyFloor={settings.safety_floor}
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
                  style={[styles.dayOverlayCard, { backgroundColor: "rgba(8,13,30,0.96)", borderColor: "rgba(148,163,184,0.20)" }]}
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

                    {selectedForecastGroups.some(group => group.key.includes("income")) ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Income</Text>
                        {selectedForecastGroups
                          .filter(group => group.key.includes("income"))
                          .flatMap(group => group.events)
                          .map(item => (
                            <View key={`overlay-income-${item.event.id}`} style={styles.dayOverlayRow}>
                              <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>{item.label}</Text>
                              <Text style={[styles.dayOverlayAmount, { color: c.success }]}>{item.amountLabel}</Text>
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
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Amount</Text>
                                  <Text style={[styles.dayBillNumberValue, { color: c.foreground }]}>${amount.toFixed(2)}</Text>
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
                                      onBlur={() => handlePaidBlur(bill.id, paidKey)}
                                      onEndEditing={event => handlePaidBlur(bill.id, paidKey, event.nativeEvent.text)}
                                      onSubmitEditing={event => handlePaidBlur(bill.id, paidKey, event.nativeEvent.text)}
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
                                      setSelectedDate(null);
                                      setDueDayPickerBill(bill);
                                    }}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="calendar" size={13} color={c.primary} />
                                    <Text style={[styles.dayBillActionText, { color: c.primary }]}>Change date</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {goalsForSelectedDay.length > 0 || plansForSelectedDay.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Plans & goals</Text>
                        {goalsForSelectedDay.map(goal => (
                          <View key={`overlay-goal-${goal.id}`} style={styles.dayOverlayRow}>
                            <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>★ {goal.name}</Text>
                            <Text style={[styles.dayOverlayAmount, { color: "#8b5cf6" }]}>-${goal.amount.toFixed(2)}</Text>
                          </View>
                        ))}
                        {plansForSelectedDay.map(plan => {
                          const amount = plan.scenario.type === "income_change" ? Math.abs(plan.scenario.amount) : -Math.abs(plan.scenario.amount);
                          return (
                            <Pressable key={`overlay-plan-${plan.id}`} onPress={() => openEditPlan(plan)} style={styles.dayOverlayRow}>
                              <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>◆ {plan.name}</Text>
                              <Text style={[styles.dayOverlayAmount, { color: amount >= 0 ? c.success : "#3b82f6" }]}>{amount >= 0 ? "+" : "-"}${Math.abs(amount).toFixed(2)}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}

                    {displayedTxs.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Activity</Text>
                        {displayedTxs.map(tx => (
                          <Pressable
                            key={`overlay-tx-${tx.id}`}
                            onPress={() => openEditTransaction(tx)}
                            style={styles.dayOverlayRow}
                          >
                            <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>{tx.note || tx.category}</Text>
                            <Text style={[styles.dayOverlayAmount, { color: tx.amount > 0 ? c.success : c.destructive }]}>
                              {tx.amount > 0 ? "+" : ""}{tx.amount.toFixed(2)}
                            </Text>
                          </Pressable>
                        ))}
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
                    <Pressable
                      onPress={() => openAddTransaction(selectedDate)}
                      style={({ pressed }) => [styles.dayOverlayFab, { backgroundColor: c.primary, opacity: pressed ? 0.82 : 1 }]}
                    >
                      <Feather name="plus" size={24} color={c.primaryForeground} />
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </Modal>

          </View>
        </View>
      )}

      {/* ── Due-day reschedule picker ── */}
      <Modal
        visible={dueDayPickerBill !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDueDayPickerBill(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setDueDayPickerBill(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }]} onPress={e => e.stopPropagation()}>
            {dueDayPickerBill && (() => {
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const customDay = getCustomDueDay(dueDayPickerBill.id, month, selectedYear);
              const effectiveDay = customDay ?? dueDayPickerBill.due_day;
              return (
                <>
                  <View style={styles.pickerHandle} />
                  <View style={styles.pickerHeader}>
                    <View>
                      <Text style={[styles.pickerTitle, { color: c.foreground }]}>{dueDayPickerBill.name}</Text>
                      <Text style={[styles.pickerSub, { color: c.mutedForeground }]}>
                        {MONTH_FULL[month]} {selectedYear} · Currently {MONTH_FULL[month].slice(0, 3)} {effectiveDay}
                        {customDay !== undefined ? " (custom)" : " (default)"}
                      </Text>
                    </View>
                    <Pressable onPress={() => setDueDayPickerBill(null)} hitSlop={8}>
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
                      const isOriginal = day === dueDayPickerBill.due_day && customDay === undefined;
                      return (
                        <Pressable
                          key={day}
                          disabled={savingDueDay}
                          onPress={() => saveDueDayChange(dueDayPickerBill, day === dueDayPickerBill.due_day ? undefined : day)}
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

                  {customDay !== undefined && (
                    <Pressable
                      disabled={savingDueDay}
                      onPress={() => saveDueDayChange(dueDayPickerBill, undefined)}
                      style={({ pressed }) => [
                        styles.pickerResetBtn,
                        { backgroundColor: c.muted, opacity: pressed ? 0.7 : 1, borderRadius: colors.radius },
                      ]}
                    >
                      <Feather name="rotate-ccw" size={14} color={c.mutedForeground} />
                      <Text style={[styles.pickerResetText, { color: c.mutedForeground }]}>
                        Reset to default {MONTH_FULL[month].slice(0, 3)} {dueDayPickerBill.due_day}
                      </Text>
                    </Pressable>
                  )}
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
          } else {
            const newTx = data as Omit<Transaction, "id">;
            await addTransaction(newTx);
            checkForRecurring(newTx);
          }
        }}
        editTx={editTx}
        defaultDate={editTx ? undefined : transactionDefaultDate}
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
        visible={snowballModalVisible}
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
      <BillSurplusModal
        visible={!!surplusPrompt}
        billName={surplusPrompt?.bill.name ?? "Bill"}
        itemType={surplusPrompt?.bill.is_debt ? "debt" : "bill"}
        budgeted={surplusPrompt?.budgeted ?? 0}
        actual={surplusPrompt?.actual ?? 0}
        targetDebt={surplusSnowballOffer?.targetDebt}
        snowballSafe={surplusSnowballOffer?.safe ?? false}
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingBottom: 12 },
  calendarBrand: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.2, marginBottom: 3, textTransform: "uppercase" },
  title: { fontSize: 36, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.2, textShadowColor: "rgba(34,211,238,0.22)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  forecastTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  iconBtn: { width: 58, height: 58, borderRadius: 21, alignItems: "center", justifyContent: "center", shadowColor: "#8b5cf6", shadowOpacity: 0.46, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 10, borderWidth: 1, borderColor: "rgba(34,211,238,0.28)" },
  calendarMonthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 22, marginTop: 2, marginBottom: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(2,6,23,0.42)", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 12 },
  monthArrowBtn: { width: 46, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "rgba(15,23,42,0.66)" },
  monthCenterLabel: { flex: 1, alignItems: "center", justifyContent: "center" },
  monthShortTitle: { fontSize: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.4 },
  monthSwipeHint: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },
  tabBar: { flexDirection: "row", padding: 4, gap: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 },
  tabBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", padding: 12 },
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

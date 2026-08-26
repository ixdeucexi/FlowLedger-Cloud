import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "@/lib/haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, BackHandler, FlatList, Keyboard, Modal, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text,
  TextInput, useWindowDimensions, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddTransactionModal } from "@/components/AddTransactionModal";
import { BillSurplusModal } from "@/components/BillSurplusModal";
import { CalendarView } from "@/components/CalendarView";
import { CommandPlusButton } from "@/components/CommandPlusButton";
import { ConfirmActionOverlay } from "@/components/ConfirmActionModal";
import { DebtPaymentAppliedModal, type DebtPaymentAppliedDetail } from "@/components/DebtPaymentAppliedModal";
import { DesktopCalendarPage } from "@/components/desktop/DesktopCalendarPage";
import { DataFreshnessLabel } from "@/components/DataFreshnessLabel";
import { EmptyState } from "@/components/EmptyState";
import { FullPaymentPromptModal } from "@/components/FullPaymentPromptModal";
import { GoalModal } from "@/components/GoalModal";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { SnowballPreviewModal } from "@/components/SnowballPreviewModal";
import colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import type { Bill, BillDateMove, DecisionRecord, Goal, IncomeItem, Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { DESKTOP_MODAL_HANDLE, DESKTOP_MODAL_OVERLAY, DESKTOP_MODAL_REGULAR, DESKTOP_MODAL_WIDE } from "@/lib/desktopModal";
import { configuredDebtAmountForRemainingPayment, parsePlannedDebtAmount } from "@/lib/debtPlanDomain";
import { confirmedBillMatchId, isConfirmedBillMatch } from "@/lib/billMatching";
import { nextPlannedDebtPayment } from "@/lib/billSurplusRouting";
import { allocationLabel, groupPlannedExpenseAllocations, matchedOccurrenceAllocations, occurrenceKey, reviewSettlementSummary, transactionDisplayName } from "@/lib/reviewCenter";
import { evaluateDecision, scenarioDates } from "@/lib/decisions";
import { buildDayForecastFloPrompt, calendarVisibleForecastEvents, forecastItemBadgeLabel, forecastItemTypeLabel, groupForecastEvents, plannedDebtEditorParams } from "@/lib/forecastDisplay";
import type { FinancialEvent } from "@/lib/forecast";
import { summarizeMonthlyBills } from "@/lib/monthlySummary";
import { buildOverdueBillOccurrences } from "@/lib/overdueBills";
import { pendingMatchStatusLabel, pendingOccurrenceKeySet, pendingPlanMatchForOccurrence } from "@/lib/pendingPlanMatches";
import { resolveBillOccurrencePayment } from "@/lib/billOccurrencePayment";
import type { SnowballProjectionResult } from "@/lib/snowball";
import { isValidDateInMonth } from "@/lib/schedule";
import type { ConfirmActionOptions } from "@/lib/confirmAction";
import {
  buildDebtPaymentPlanSummary,
  isScheduledSnowballPlanTransaction,
  isSnowballPaymentTransaction,
  requiredDebtPlanTotal,
  retainedDebtPaymentBreakdown,
  snowballPaymentName,
  snowballPlanTotalThroughDate,
} from "@/lib/debtPaymentPlan";
import { hasBucketRemainderFunding, latestBucketRemainderAvailableDate } from "@/lib/snowballFunding";
import { readInterfacePreferences, updateInterfacePreferences } from "@/lib/interfacePreferences";

const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const FREQ_LABELS: Record<string, string> = { monthly: "Monthly", biweekly: "Biweekly", weekly: "Weekly", quarterly: "Quarterly" };

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

function formatCompactOverlayDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function isoDateForMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayFromIsoDate(date: string) {
  const day = Number(date.slice(8, 10));
  return Number.isFinite(day) ? day : 1;
}

function debtSurplusTransactionImportHash(sourceDebtId: string, month: number, year: number) {
  return `flowledger:debt-surplus:${sourceDebtId}:${year}-${String(month + 1).padStart(2, "0")}`;
}

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PayStatus({
  paid,
  partial,
  overdue = false,
  scheduledLabel,
  pendingLabel,
}: {
  paid: boolean;
  partial: boolean;
  overdue?: boolean;
  scheduledLabel?: string;
  pendingLabel?: string;
}) {
  const c = useColors();
  if (pendingLabel) return <View style={[ps.badge, { backgroundColor: "#3b82f625" }]}><Text style={[ps.text, { color: "#60a5fa" }]}>{pendingLabel}</Text></View>;
  if (paid) return <View style={[ps.badge, { backgroundColor: c.success + "25" }]}><Text style={[ps.text, { color: c.success }]}>PAID</Text></View>;
  if (overdue) return <View style={[ps.badge, { backgroundColor: c.destructive + "25" }]}><Text style={[ps.text, { color: c.destructive }]}>OVERDUE</Text></View>;
  if (partial) return <View style={[ps.badge, { backgroundColor: c.warning + "25" }]}><Text style={[ps.text, { color: c.warning }]}>PARTIAL</Text></View>;
  if (scheduledLabel) return <View style={[ps.badge, { backgroundColor: c.primary + "20" }]}><Text style={[ps.text, { color: c.primary }]}>{scheduledLabel.toUpperCase()}</Text></View>;
  return <View style={[ps.badge, { backgroundColor: c.destructive + "20" }]}><Text style={[ps.text, { color: c.destructive }]}>UNPAID</Text></View>;
}
const ps = StyleSheet.create({
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
});

function CalendarDebtPaymentCard({
  name,
  amount,
  applied,
  statusLabel,
  paymentType,
  requiredMinimum,
  snowballMonthToDate,
  onEdit,
  onRemove,
  inlineEdit,
  retainedPayment,
}: {
  name: string;
  amount: number;
  applied: boolean;
  statusLabel: string;
  paymentType: string;
  requiredMinimum?: number;
  snowballMonthToDate?: number;
  onEdit?: () => void;
  onRemove?: () => void;
  retainedPayment?: ReturnType<typeof retainedDebtPaymentBreakdown>;
  inlineEdit?: {
    canEdit: boolean;
    alreadyPaid: number;
    originalPlanned: number;
    onSave: (remainingAmount: number) => Promise<void>;
  };
}) {
  const c = useColors();
  const paymentPlan = buildDebtPaymentPlanSummary(requiredMinimum ?? 0, snowballMonthToDate ?? amount);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(amount.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [showRetainedPaymentInfo, setShowRetainedPaymentInfo] = useState(false);
  const parsedDraft = parsePlannedDebtAmount(draft);

  useEffect(() => {
    if (!editing) setDraft(amount.toFixed(2));
  }, [amount, editing]);

  const beginEdit = () => {
    if (inlineEdit) {
      setDraft(amount.toFixed(2));
      setEditError(undefined);
      setEditing(true);
      return;
    }
    onEdit?.();
  };

  const saveRemainingPayment = async () => {
    if (!inlineEdit || !inlineEdit.canEdit || saving) return;
    if (parsedDraft === undefined) {
      setEditError("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setSaving(true);
    setEditError(undefined);
    try {
      await inlineEdit.onSave(parsedDraft);
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "The planned payment could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: "#3b82f640" }]}
    >
      <View style={styles.dayBillTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{name}</Text>
          <Text style={[styles.dayBillMeta, { color: c.mutedForeground }]}>{paymentType} payment</Text>
        </View>
        <View style={styles.dayDebtBadgeRow}>
          {retainedPayment ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Why $${retainedPayment.scheduledPayment.toFixed(2)} is still planned for ${name}`}
              accessibilityState={{ expanded: showRetainedPaymentInfo }}
              onPress={() => setShowRetainedPaymentInfo(current => !current)}
              style={({ pressed }) => [styles.dayDebtInfoButton, { backgroundColor: c.primary + "18", borderColor: c.primary + "42", opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="info" size={16} color={c.primary} />
            </Pressable>
          ) : null}
          <View style={[styles.dayTransactionBadge, { backgroundColor: "#3b82f620" }]}>
            <Text style={[styles.dayTransactionBadgeText, { color: "#3b82f6" }]}>{statusLabel.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <View style={styles.dayBillNumbers}>
        <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
          <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Amount</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: c.foreground }]}>${amount.toFixed(2)}</Text>
        </View>
        <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
          <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Paid</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: applied ? c.success : c.mutedForeground }]}>${(applied ? amount : 0).toFixed(2)}</Text>
        </View>
        <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
          <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: applied ? c.success : c.warning }]}>${(applied ? 0 : amount).toFixed(2)}</Text>
        </View>
      </View>

      {retainedPayment && showRetainedPaymentInfo ? (
        <View style={[styles.retainedDebtInfo, { backgroundColor: c.primary + "10", borderColor: c.primary + "38" }]}>
          <Text style={[styles.retainedDebtInfoTitle, { color: c.foreground }]}>{`Why $${retainedPayment.scheduledPayment.toFixed(2)} is still planned`}</Text>
          <Text style={[styles.retainedDebtInfoText, { color: c.mutedForeground }]}>
            {`You already paid $${retainedPayment.alreadyPaid.toFixed(2)}. That leaves $${retainedPayment.minimumRemaining.toFixed(2)} of this month’s $${retainedPayment.minimumRequired.toFixed(2)} minimum.`}
          </Text>
          <Text style={[styles.retainedDebtInfoHighlight, { color: c.primary }]}>
            {`You chose to keep the full $${retainedPayment.scheduledPayment.toFixed(2)} payment. $${retainedPayment.minimumRemaining.toFixed(2)} completes the minimum and $${retainedPayment.extraPrincipal.toFixed(2)} goes toward extra principal.`}
          </Text>
        </View>
      ) : null}

      {requiredMinimum !== undefined ? (
        <View style={[styles.dayDebtPlanSummary, { backgroundColor: c.background + "66", borderColor: c.border }]}>
          <Text style={[styles.dayDebtPlanText, { color: c.mutedForeground }]}>
            Required {`$${paymentPlan.requiredMinimum.toFixed(2)}`} + snowball through this date {`$${paymentPlan.extraPayment.toFixed(2)}`}
          </Text>
          <Text style={[styles.dayDebtPlanTotal, { color: c.success }]}>{`$${paymentPlan.totalPlanned.toFixed(2)}`} planned for debt this month</Text>
          <Text style={[styles.dayDebtPlanNote, { color: c.mutedForeground }]}>The snowball extra does not change the required payment.</Text>
        </View>
      ) : null}

      {editing && inlineEdit ? (
        <View style={[styles.inlineDebtEditor, { backgroundColor: c.background + "88", borderColor: c.primary + "45" }]}>
          <Text style={[styles.inlineDebtEditorLabel, { color: c.primary }]}>PAYMENT STILL PLANNED</Text>
          <View style={[styles.inlineDebtEditorInputWrap, { borderColor: editError ? c.destructive : c.border, backgroundColor: c.background }]}>
            <Text style={[styles.inlineDebtEditorDollar, { color: c.mutedForeground }]}>$</Text>
            <TextInput
              accessibilityLabel={`Remaining planned payment for ${name}`}
              editable={inlineEdit.canEdit && !saving}
              inputMode="decimal"
              keyboardType="decimal-pad"
              selectTextOnFocus
              value={draft}
              onChangeText={value => {
                setDraft(value);
                setEditError(undefined);
              }}
              style={[styles.inlineDebtEditorInput, { color: c.foreground }]}
            />
          </View>
          <Text style={[styles.inlineDebtEditorCopy, { color: c.mutedForeground }]}>
            {inlineEdit.alreadyPaid > 0.005
              ? `Your $${inlineEdit.alreadyPaid.toFixed(2)} payment already made stays recorded. Enter what you still want scheduled.`
              : "Enter what you still want scheduled for this payment."}
          </Text>
          {inlineEdit.alreadyPaid > 0.005 && inlineEdit.originalPlanned > 0.005 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Keep the original $${inlineEdit.originalPlanned.toFixed(2)} payment scheduled`}
              disabled={!inlineEdit.canEdit || saving}
              onPress={() => {
                setDraft(inlineEdit.originalPlanned.toFixed(2));
                setEditError(undefined);
              }}
              style={({ pressed }) => [styles.inlineDebtEditorSuggestion, { backgroundColor: c.primary + "16", borderColor: c.primary + "38", opacity: !inlineEdit.canEdit || saving ? 0.45 : pressed ? 0.72 : 1 }]}
            >
              <Feather name="rotate-ccw" size={13} color={c.primary} />
              <Text style={[styles.inlineDebtEditorSuggestionText, { color: c.primary }]}>{`Keep $${inlineEdit.originalPlanned.toFixed(2)} scheduled`}</Text>
            </Pressable>
          ) : null}
          {parsedDraft !== undefined && inlineEdit.alreadyPaid > 0.005 ? (
            <Text style={[styles.inlineDebtEditorTotal, { color: c.foreground }]}>
              {`Paid + planned total: $${(inlineEdit.alreadyPaid + parsedDraft).toFixed(2)}`}
            </Text>
          ) : null}
          {editError ? <Text style={[styles.inlineDebtEditorError, { color: c.destructive }]}>{editError}</Text> : null}
          {!inlineEdit.canEdit ? <Text style={[styles.inlineDebtEditorError, { color: c.mutedForeground }]}>Only an owner or editor can change this household plan.</Text> : null}
          <View style={styles.inlineDebtEditorActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel planned payment edit"
              disabled={saving}
              onPress={() => {
                setEditing(false);
                setEditError(undefined);
              }}
              style={({ pressed }) => [styles.inlineDebtEditorButton, { borderColor: c.border, opacity: pressed ? 0.72 : 1 }]}
            >
              <Text style={[styles.inlineDebtEditorButtonText, { color: c.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save remaining planned payment"
              accessibilityState={{ disabled: !inlineEdit.canEdit || saving || parsedDraft === undefined }}
              disabled={!inlineEdit.canEdit || saving || parsedDraft === undefined}
              onPress={() => { void saveRemainingPayment(); }}
              style={({ pressed }) => [styles.inlineDebtEditorButton, { backgroundColor: c.primary, borderColor: c.primary, opacity: !inlineEdit.canEdit || saving || parsedDraft === undefined ? 0.45 : pressed ? 0.76 : 1 }]}
            >
              <Text style={[styles.inlineDebtEditorButtonText, { color: c.primaryForeground }]}>{saving ? "Saving..." : "Save payment"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {onEdit || inlineEdit || onRemove ? (
        <View style={styles.dayBillActions}>
          {onEdit || inlineEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${name} snowball payment`}
              onPress={beginEdit}
              style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
            >
              <Feather name="edit-2" size={13} color={c.primary} />
              <Text style={[styles.dayBillActionText, { color: c.primary }]}>Edit</Text>
            </Pressable>
          ) : null}
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${name} snowball payment`}
              onPress={onRemove}
              style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
            >
              <Feather name="rotate-ccw" size={13} color={c.destructive} />
              <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function MonthlyScreen() {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const { width: viewportWidth, fontScale } = useWindowDimensions();
  const isNarrowForecastLayout = !isDesktop && viewportWidth <= 390;
  const stackForecastHeader = isNarrowForecastLayout && fontScale > 1.35;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isFeatureLocked } = useMembership();
  const routeParams = useLocalSearchParams<{ openDate?: string | string[]; openDateAt?: string | string[] }>();
  const { user } = useAuth();
  const {
    bills, overrides, billDateMoves, transactions, pendingBankTransactions, pendingPlanMatches, extraPayments, goals, decisions, getAmount, getPaidAmount, setPaidAmount, setCustomAmount,
    getCustomDueDay, setCustomDueDay,
    moveBillOccurrence, removeBillOccurrenceMove, getBillDateMoveForOccurrence,
    getMonthlyBills, getBillOccurrencesInMonth, getBillMonthlyTotal, settings,
    selectedYear, setSelectedYear, dashboardFilter, setDashboardFilter,
    getTransactionsForMonth, addTransaction, updateTransaction, deleteTransaction, addBill, deleteBill, updateIncome,
    getCashFlow, getMonthlyIncome, getDailyBalances, getCalendarDailyBalances, getIncomeOccurrencesInMonth,
    previewDebtSnowball, applyDebtSnowballPayment, removeDebtSnowballPayment, finalizeBillPayment, getExtraPayment, getDebtPlanForMonth, getRemainingDebtPlanForMonth, setPlannedDebtAmount, canEditHousehold,
    updateDecision, deleteDecision, updateGoal, deleteGoal, activeHousehold, dataUpdatedAt,
  } = useBudget();

  const [month, setMonth] = useState(new Date().getMonth());
  const [activeTab] = useState<TabView>("calendar");
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [editingBucket, setEditingBucket] = useState<Goal | null>(null);
  const [transactionDefaultDate, setTransactionDefaultDate] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayConfirmation, setDayConfirmation] = useState<ConfirmActionOptions | null>(null);
  const handledOpenDateRef = useRef<string | null>(null);
  const calendarPreferenceReadyRef = useRef(false);
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

  useEffect(() => {
    if (!user || !activeHousehold) return;
    calendarPreferenceReadyRef.current = false;
    let active = true;
    const requestedDate = Array.isArray(routeParams.openDate) ? routeParams.openDate[0] : routeParams.openDate;
    void readInterfacePreferences(user.id, activeHousehold.householdId).then(preferences => {
      if (!active) return;
      const saved = preferences.calendar;
      if (!requestedDate && saved && saved.month >= 0 && saved.month <= 11 && saved.year >= 2000 && saved.year <= 2200) {
        setMonth(saved.month);
        setSelectedYear(saved.year);
        setSelectedDate(saved.selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate) ? saved.selectedDate : null);
      }
      calendarPreferenceReadyRef.current = true;
    });
    return () => { active = false; };
  }, [activeHousehold?.householdId, routeParams.openDate, setSelectedYear, user?.id]);

  useEffect(() => {
    if (!user || !activeHousehold || !calendarPreferenceReadyRef.current) return;
    void updateInterfacePreferences(user.id, activeHousehold.householdId, {
      calendar: {
        month,
        year: selectedYear,
        ...(selectedDate ? { selectedDate } : {}),
      },
    });
  }, [activeHousehold?.householdId, month, selectedDate, selectedYear, user?.id]);

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
  const [surplusRouteMode, setSurplusRouteMode] = useState<"next" | "date">("next");
  const [debtPaymentNotice, setDebtPaymentNotice] = useState<DebtPaymentAppliedDetail | null>(null);
  const [editPlan, setEditPlan] = useState<DecisionRecord | null>(null);
  const [editPlanName, setEditPlanName] = useState("");
  const [editPlanAmount, setEditPlanAmount] = useState("");
  const [editPlanDate, setEditPlanDate] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingPaidKey, setSavingPaidKey] = useState<string | null>(null);
  const [monthSearchVisible, setMonthSearchVisible] = useState(false);
  const [monthSearchQuery, setMonthSearchQuery] = useState("");

  useBackDismiss(txModalVisible, () => {
    setTxModalVisible(false);
    setEditTx(null);
    setTransactionDefaultDate(undefined);
  });
  useBackDismiss(Boolean(dueDayPicker), () => setDueDayPicker(null));
  useBackDismiss(Boolean(incomeDatePicker), () => setIncomeDatePicker(null));
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
      .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.debt_applied_amount) || 0), 0);
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
  }, [debtPaymentNotice, dueDayPickerBill, editPlan, fullPaymentPrompt, incomeDatePicker, selectedDate, showSnowballResults, snowballModalVisible, snowballPreview, surplusPrompt, txModalVisible]);

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
  const transferTransactionIds = useMemo(
    () => new Set(
      calendarTransactions
        .filter(transaction => transaction.review_status === "transfer" || Boolean(transaction.transfer_group_id))
        .map(transaction => transaction.id),
    ),
    [calendarTransactions],
  );
  const billOccurrenceMatches = useMemo(() => matchedOccurrenceAllocations(txList, "bill"), [txList]);
  const incomeOccurrenceMatches = useMemo(() => matchedOccurrenceAllocations(txList, "income"), [txList]);
  const pendingBillOccurrenceKeys = useMemo(
    () => pendingOccurrenceKeySet(pendingPlanMatches, pendingBankTransactions),
    [pendingPlanMatches, pendingBankTransactions],
  );
  const overdueBillOccurrenceMap = useMemo(() => {
    const now = new Date();
    const viewedMonth = selectedYear * 12 + month;
    const currentMonth = now.getFullYear() * 12 + now.getMonth();
    const overdueCutoffDay = viewedMonth < currentMonth
      ? new Date(selectedYear, month + 1, 0).getDate() + 1
      : viewedMonth === currentMonth
        ? now.getDate()
        : 0;
    const occurrences = buildOverdueBillOccurrences(
      monthBills.map(bill => ({
        billId: bill.id,
        name: bill.name,
        closed: bill.is_debt && bill.balance <= 0.009,
        occurrenceDays: getBillOccurrencesInMonth(bill, month, selectedYear),
        plannedTotal: getBillMonthlyTotal(bill, month, selectedYear),
        paidTotal: getEffectivePaidAmount(bill, month, selectedYear),
      })),
      month,
      selectedYear,
      overdueCutoffDay,
    ).filter(occurrence => !pendingBillOccurrenceKeys.has(occurrenceKey(occurrence.billId, occurrence.occurrenceDate)));

    return new Map(occurrences.map(occurrence => [occurrenceKey(occurrence.billId, occurrence.occurrenceDate), occurrence] as const));
  }, [
    getBillMonthlyTotal,
    getBillOccurrencesInMonth,
    getEffectivePaidAmount,
    month,
    monthBills,
    pendingBillOccurrenceKeys,
    selectedYear,
  ]);
  const overdueBillOccurrenceKeys = useMemo(
    () => new Set(overdueBillOccurrenceMap.keys()),
    [overdueBillOccurrenceMap],
  );
  const projectedDailyBalances = useMemo(
    () => getDailyBalances(month, selectedYear),
    [getDailyBalances, month, selectedYear],
  );
  const dailyBalances = useMemo(
    () => getCalendarDailyBalances(month, selectedYear),
    [getCalendarDailyBalances, month, selectedYear],
  );
  const calendarDataReady = Boolean(dataUpdatedAt);
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
  const selectedDay = selectedDate ? parseInt(selectedDate.split("-")[2]) : null;
  const selectedForecastDay = !calendarDataReady || selectedDay === null
    ? undefined
    : dailyBalances.find(item => item.day === selectedDay);
  const selectedForecastGroups = useMemo(
    () => groupForecastEvents(calendarVisibleForecastEvents(selectedForecastDay?.events)),
    [selectedForecastDay]
  );
  const selectedDebtPayments = useMemo(
    () => selectedForecastGroups.find(group => group.key === "debt")?.events ?? [],
    [selectedForecastGroups],
  );
  const selectedMonthFullDebtPlan = useMemo(
    () => getDebtPlanForMonth(month, selectedYear),
    [getDebtPlanForMonth, month, selectedYear],
  );
  const selectedMonthRemainingDebtPlan = useMemo(
    () => getRemainingDebtPlanForMonth(month, selectedYear),
    [getRemainingDebtPlanForMonth, month, selectedYear],
  );
  const selectedSnowballTransactions = useMemo(
    () => selectedDate
      ? calendarTransactions.filter(transaction =>
        transaction.date === selectedDate && isSnowballPaymentTransaction(transaction))
      : [],
    [calendarTransactions, selectedDate],
  );
  const snowballPlanEntries = useMemo(
    () => [
      ...extraPayments.map(payment => ({
        amount: payment.amount,
        date: payment.payment_date ?? `${payment.year}-${String(payment.month + 1).padStart(2, "0")}-01`,
      })),
      ...transactions
        .filter(isScheduledSnowballPlanTransaction)
        .map(transaction => ({ amount: transaction.amount, date: transaction.date })),
    ],
    [extraPayments, transactions],
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
      if (bill.is_debt && selectedDebtPayments.some(payment =>
        payment.event.sourceId === bill.id || payment.event.debtTargetBillId === bill.id
      )) return false;
      const match = billOccurrenceMatches.get(occurrenceKey(bill.id, occurrenceDate));
      return !match || match.settlement === "partial";
    });
  }, [monthBills, billOccurrenceMatches, getBillOccurrencesInMonth, selectedDebtPayments, selectedDay, month, selectedYear]);

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
  const monthlyIncome = getMonthlyIncome(month, selectedYear);

  const surplusSnowballOffer = useMemo(() => {
    if (!surplusPrompt || !settings.debtPayoffEnabled) return null;
    const surplus = Math.max(0, surplusPrompt.budgeted - surplusPrompt.actual);
    const existing = getExtraPayment(month, selectedYear);
    const previousSource = existing?.sources?.find(source => source.type === "bill_surplus" && source.billId === surplusPrompt.bill.id)?.amount ?? 0;
    const total = Math.max(0, (existing?.amount ?? 0) - previousSource + surplus);
    const targetPreview = previewDebtSnowball(month, selectedYear, total, surplus - previousSource);
    const targetDebtId = targetPreview.allocations[0]?.billId;
    const nextPayment = nextPlannedDebtPayment(
      getRemainingDebtPlanForMonth(month, selectedYear)?.allocations ?? [],
      targetDebtId,
      surplusPrompt.paidDate,
    );
    const selectedPaymentDate = surplusRouteMode === "next" ? nextPayment?.date ?? "" : surplusPaymentDate;
    const validDate = isValidDateInMonth(selectedPaymentDate, month, selectedYear);
    const preview = previewDebtSnowball(month, selectedYear, total, surplus - previousSource, validDate ? selectedPaymentDate : undefined);
    return {
      preview,
      total,
      targetDebt: preview.months[0]?.targetName ?? preview.allocations[0]?.billName,
      dateValid: validDate,
      nextPayment,
      paymentDate: selectedPaymentDate,
      safe: validDate && preview.selectedExtra + 0.005 >= total,
    };
  }, [surplusPrompt, surplusPaymentDate, surplusRouteMode, getExtraPayment, getRemainingDebtPlanForMonth, previewDebtSnowball, month, selectedYear, settings.debtPayoffEnabled]);

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

  const openDebtPaymentActivity = useCallback(() => {
    setSelectedDate(null);
    router.push("/(tabs)/transactions" as never);
  }, [router]);

  const explainDebtPaymentRoute = useCallback(() => {
    Alert.alert(
      "Record debt payments in Activity",
      "Matching the payment there updates both the paid amount and debt balance together.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Open Activity", onPress: openDebtPaymentActivity },
      ],
    );
  }, [openDebtPaymentActivity]);

  const keepPromptAsPartialPayment = useCallback(async () => {
    if (!fullPaymentPrompt) return;
    const { bill, actual, paidKey, editValue } = fullPaymentPrompt;
    if (bill.is_debt) {
      closeFullPaymentPrompt();
      explainDebtPaymentRoute();
      return;
    }
    paidSaveInFlightRef.current.add(paidKey);
    setSavingPaidKey(paidKey);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await setPaidAmount(bill.id, month, selectedYear, actual);
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
  }, [clearPaidEditForKey, closeFullPaymentPrompt, explainDebtPaymentRoute, fullPaymentPrompt, month, selectedYear, setPaidAmount]);

  const confirmPromptAsFullPayment = useCallback(() => {
    if (!fullPaymentPrompt) return;
    const { bill, budgeted, actual, paidDate, paidKey, editValue } = fullPaymentPrompt;
    if (bill.is_debt) {
      closeFullPaymentPrompt();
      explainDebtPaymentRoute();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSurplusPrompt({ bill, budgeted, actual, paidDate, matchAmountToActual: true });
    setSurplusPaymentDate(paidDate);
    setSurplusRouteMode("next");
    setSelectedDate(null);
    paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [paidKey]: { value: editValue, at: Date.now() } };
    clearPaidEditForKey(paidKey);
    paidPromptPendingRef.current.delete(paidKey);
    setFullPaymentPrompt(null);
  }, [clearPaidEditForKey, closeFullPaymentPrompt, explainDebtPaymentRoute, fullPaymentPrompt]);

  const handlePaidBlur = useCallback(async (billId: string, key: string, submittedValue?: string) => {
    if (savingPaidKey === key || paidSaveInFlightRef.current.has(key) || paidPromptPendingRef.current.has(key)) return;
    const bill = bills.find(item => item.id === billId);
    if (bill?.is_debt) {
      clearPaidEditForKey(key);
      explainDebtPaymentRoute();
      return;
    }
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
      if (trimmed.length === 0) {
        clearPaidEdit();
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
        const sources = (existing?.sources ?? [])
          .filter(source => !(source.type === "bill_surplus" && source.billId === billId));
        if (newSurplus > 0.005) sources.push({ ...previousSource, amount: newSurplus });
        const total = sources.reduce((sum, source) => sum + source.amount, 0);
        const preview = previewDebtSnowball(month, selectedYear, total);
        await finalizeBillPayment(bill.id, month, selectedYear, parsed, paidDate);
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
      if (bill) await finalizeBillPayment(billId, month, selectedYear, parsed, paidDate);
      else await setPaidAmount(billId, month, selectedYear, parsed);
      paidSaveSnapshotRef.current = { ...paidSaveSnapshotRef.current, [key]: { value: trimmed, at: Date.now() } };
      clearPaidEdit();
      if (bill) askToTreatPaidAsFullPayment({ bill, budgeted, actual: parsed, paidDate });
    } finally {
      paidSaveInFlightRef.current.delete(key);
      setSavingPaidKey(current => current === key ? null : current);
    }
  }, [clearPaidEditForKey, editingPaid, savingPaidKey, setPaidAmount, bills, overrides, getBillMonthlyTotal, getCustomDueDay, getExtraPayment, previewDebtSnowball, finalizeBillPayment, applyDebtSnowballPayment, removeDebtSnowballPayment, askToTreatPaidAsFullPayment, parsePaidInput, month, selectedYear, explainDebtPaymentRoute]);

  const finalizeBillAtActualForMonth = useCallback(async (prompt: { bill: Bill; actual: number; paidDate: string }) => {
    if (prompt.bill.is_debt) {
      throw new Error("Record or match this debt payment in Activity so the payment and debt balance save together.");
    }
    await finalizeBillPayment(prompt.bill.id, month, selectedYear, prompt.actual, prompt.paidDate);
  }, [finalizeBillPayment]);

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
    if (surplusPrompt.bill.is_debt) {
      setSurplusPrompt(null);
      explainDebtPaymentRoute();
      return;
    }
    if (!settings.debtPayoffEnabled) {
      await finalizeBillAtActualForMonth(surplusPrompt);
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

  const addBillSurplusToSnowball = async () => {
    if (!surplusPrompt || !surplusSnowballOffer) return;
    const surplus = surplusPrompt.budgeted - surplusPrompt.actual;
    if (surplusPrompt.bill.is_debt) {
      setSurplusPrompt(null);
      explainDebtPaymentRoute();
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
    if (bill?.is_debt) {
      explainDebtPaymentRoute();
      return;
    }
    if (isPaid) await removeDebtSurplusTransaction(billId);
    await setPaidAmount(billId, month, selectedYear, isPaid ? 0 : amount);
  }, [setPaidAmount, removeDebtSurplusTransaction, bills, explainDebtPaymentRoute]);

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
    const existing = getExtraPayment(month, selectedYear);
    const preview = previewDebtSnowball(month, selectedYear, amt, 0, existing?.payment_date, existing?.id);
    setSnowballPreview(preview);
    setSnowballModalVisible(true);
    Keyboard.dismiss();
  };

  const updateSnowballAmount = (value: string) => {
    setExtraPayment(value);
    const amount = Number.parseFloat(value) || 0;
    const existing = getExtraPayment(month, selectedYear);
    setSnowballPreview(previewDebtSnowball(month, selectedYear, amount, 0, existing?.payment_date, existing?.id));
  };

  const confirmSnowballPayment = async () => {
    if (!snowballPreview) return;
    try {
      await applyDebtSnowballPayment(snowballPreview);
      setSnowballResults(snowballPreview.allocations.map(r => ({ name: r.billName, payment: r.payment, paidOff: r.paidOff })));
      setShowSnowballResults(true);
      setSnowballModalVisible(false);
      setExtraPayment("");
    } catch (error) {
      Alert.alert("Couldn’t update payment", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const removeSavedSnowballPayment = async () => {
    const saved = getExtraPayment(month, selectedYear);
    if (hasBucketRemainderFunding(saved?.sources)) {
      Alert.alert("Reopen bucket first", "Reopen the routed spending bucket before removing this Snowball payment.");
      return;
    }
    try {
      await removeDebtSnowballPayment(month, selectedYear);
      setSnowballModalVisible(false);
    } catch (error) {
      Alert.alert("Couldn’t remove payment", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleDeleteTx = (id: string) => {
    const tx = transactions.find(transaction => transaction.id === id);
    const isTransfer = Boolean(tx?.transfer_group_id);
    const doDelete = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); deleteTransaction(id); };
    setDayConfirmation({
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
    setDayConfirmation({
      title: "Remove Plan",
      message: `Remove "${decision.name}" from your calendar and forecast?`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: doDelete,
    });
  };

  const handleDeleteBillFromDay = useCallback((bill: Bill) => {
    const itemLabel = bill.is_debt ? "debt" : "bill";
    setDayConfirmation({
      title: `Delete ${bill.is_debt ? "Debt" : "Bill"}`,
      message: `Delete "${bill.name}" completely? This removes it from Bills and Forecast. Existing Activity entries stay for history.`,
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

  const handleDeleteIncomeFromDay = useCallback((income: IncomeItem, day: number) => {
    const occurrenceDate = isoDateForMonthDay(selectedYear, month, day);
    setDayConfirmation({
      title: "Remove This Payday",
      message: `Remove "${income.name}" on ${formatShortDate(occurrenceDate)}? The income and future paydays will stay.`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: async () => {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await updateIncome({
            ...income,
            excluded_dates: Array.from(new Set([
              ...(income.excluded_dates ?? []).map(date => date.slice(0, 10)),
              occurrenceDate,
            ])).sort(),
          });
        } catch (error) {
          Alert.alert("Couldn't remove payday", error instanceof Error ? error.message : "Try again in a moment.");
        }
      },
    });
  }, [month, selectedYear, updateIncome]);

  const handleDeleteGoalFromDay = useCallback((goalId: string, goalName: string) => {
    setDayConfirmation({
      title: "Delete Bucket",
      message: `Delete "${goalName}"? This removes the bucket from Forecast and your plan.`,
      confirmText: "Delete bucket",
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

  const openEditBucket = useCallback((goalId: string) => {
    const bucket = goals.find(goal => goal.id === goalId && goal.goal_type === "planned_expense");
    if (!bucket) {
      Alert.alert("Bucket not found", "Refresh Forecast and try again.");
      return;
    }
    setSelectedDate(null);
    setTimeout(() => setEditingBucket(bucket), 0);
  }, [goals]);

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
      const baseline = projectedDailyBalances
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
      if (isSnowballPaymentTransaction(transaction)) return false;
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
  const selectedVisibleItemCount = scheduledBillsForDay.length + selectedDebtPayments.length + selectedSnowballTransactions.length + incomeForSelectedDay.length + displayedTxs.length + plannedExpenseGroupsForSelectedDay.length + displayedGoalsForSelectedDay.length + plansForSelectedDay.length;
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

  const desktopSelectionMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    const monthKey = `${selectedYear}-${month}`;
    if (desktopSelectionMonthRef.current === monthKey) return;
    desktopSelectionMonthRef.current = monthKey;
    setSelectedDate(isCurrentMonth ? todayIso : isoDateForMonthDay(selectedYear, month, 1));
  }, [isCurrentMonth, isDesktop, month, selectedYear, todayIso]);

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

  const openPlannedDebtPaymentEditor = useCallback((event: FinancialEvent) => {
    const editorParams = plannedDebtEditorParams(event);
    if (!editorParams) return false;
    setSelectedDate(null);
    router.push({
      pathname: "/planned-debt-payment",
      params: editorParams,
    } as never);
    return true;
  }, [router]);

  const openDesktopCalendarEvent = (event: FinancialEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (event.sourceType === "transaction") {
      const transaction = transactions.find(item => item.id === event.sourceId);
      if (transaction) openEditTransaction(transaction);
      return;
    }
    if (event.sourceType === "bill") {
      const bill = bills.find(item => item.id === event.sourceId);
      if (!bill) return;
      setSelectedDate(null);
      setDueDayPicker({ bill, fromDate: event.date });
      return;
    }
    if (event.sourceType === "income") {
      const occurrence = incomeOccurrences.find(item => item.incomeId === event.sourceId && item.day === dayFromIsoDate(event.date));
      if (!occurrence) return;
      setSelectedDate(null);
      setIncomeDatePicker({ income: occurrence.income, day: occurrence.day, amount: occurrence.amount });
      return;
    }
    if (event.sourceType === "goal") {
      openEditBucket(event.sourceId);
      return;
    }
    if (event.sourceType === "decision") {
      const plan = decisions.find(item => item.id === event.sourceId);
      if (plan) {
        setSelectedDate(null);
        openEditPlan(plan);
      }
      return;
    }
    if (event.sourceType === "extra_payment") {
      if (openPlannedDebtPaymentEditor(event)) return;
      setSelectedDate(null);
      setSnowballModalVisible(true);
    }
  };

  const webTopPad = Platform.OS === "web" ? 4 : 0;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {isDesktop ? (
        <DesktopCalendarPage
          month={month}
          year={selectedYear}
          selectedDate={selectedDate}
          dailyBalances={calendarDataReady ? dailyBalances : []}
          projectedDailyBalances={calendarDataReady ? projectedDailyBalances : []}
          transferTransactionIds={transferTransactionIds}
          overdueBillOccurrenceKeys={overdueBillOccurrenceKeys}
          safetyFloor={settings.safety_floor}
          getCalendarDailyBalances={getCalendarDailyBalances}
          onToday={jumpToToday}
          onPreviousMonth={() => changeMonth(-1)}
          onNextMonth={() => changeMonth(1)}
          onOpenMonthSelector={openMonthSearch}
          simulatorLocked={isFeatureLocked("plan_simulator")}
          onOpenPlanSimulator={() => router.push("/plan-simulator")}
          onAddTransaction={openAddTransaction}
          onSelectDate={setSelectedDate}
          onCloseSelectedDay={() => setSelectedDate(null)}
          onOpenEvent={openDesktopCalendarEvent}
        />
      ) : (
        <>
      <PremiumBackdrop variant="purple" />
      <View style={[
        styles.header,
        isDesktop && styles.desktopHeader,
        isNarrowForecastLayout && styles.narrowHeader,
        stackForecastHeader && styles.stackedHeader,
        { paddingTop: insets.top + 12 + webTopPad },
      ]}>
        <View style={[styles.headerCopy, stackForecastHeader && styles.stackedHeaderCopy]}>
          <Text numberOfLines={1} style={[styles.calendarBrand, { color: c.primary }]}>FLOWLEDGER ALGO</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[styles.calendarScreenLabel, { color: c.foreground }]}
          >
            Forecast
          </Text>
          {isFuture && <Text style={[styles.forecastTag, { color: c.primary }]}>Forecast Mode</Text>}
        </View>
        <View style={[
          styles.headerActions,
          isNarrowForecastLayout && styles.narrowHeaderActions,
          stackForecastHeader && styles.stackedHeaderActions,
        ]}>
          <Pressable
            onPress={() => router.push("/plan-simulator")}
            accessibilityRole="button"
            accessibilityLabel={`${isFeatureLocked("plan_simulator") ? "Locked Pro " : ""}Plan Simulator`}
            style={({ pressed }) => [
              styles.simulatorButton,
              isNarrowForecastLayout && styles.narrowSimulatorButton,
              { borderColor: c.primary + "55", backgroundColor: c.primary + "14", opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Feather name={isFeatureLocked("plan_simulator") ? "lock" : "sliders"} size={15} color={c.primary} />
            {!isNarrowForecastLayout ? <Text style={[styles.simulatorButtonText, { color: c.primary }]}>Simulator</Text> : null}
          </Pressable>
          <Pressable
            onPress={jumpToToday}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            style={({ pressed }) => [
              styles.todayChip,
              isNarrowForecastLayout && styles.narrowTodayChip,
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
            size={isNarrowForecastLayout ? 44 : 54}
            iconSize={isNarrowForecastLayout ? 20 : 22}
          />
        </View>
      </View>
      <DataFreshnessLabel inset compact />

      <View
        style={[
          styles.calendarMonthBar,
          isDesktop && styles.desktopMonthBar,
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
          nativeID="guided-tour-monthly"
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
                      Extra Debt Payment (Snowball)
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
                        accessibilityRole="button"
                        accessibilityLabel={bill.is_debt ? `Record ${bill.name} payment in Activity` : isPaid ? `Mark ${bill.name} unpaid` : `Mark ${bill.name} paid`}
                        onPress={bill.is_debt ? openDebtPaymentActivity : () => handleQuickPaid(bill.id, amount, isPaid)}
                        style={({ pressed }) => [styles.quickPaidBtn, { backgroundColor: bill.is_debt ? c.primary + "18" : isPaid ? c.muted : c.success + "20", opacity: pressed ? 0.7 : 1, borderRadius: 8, marginTop: 6 }]}
                      >
                        <Feather name={bill.is_debt ? "activity" : isPaid ? "x" : "check"} size={12} color={bill.is_debt ? c.primary : isPaid ? c.mutedForeground : c.success} />
                        <Text style={[styles.quickPaidText, { color: bill.is_debt ? c.primary : isPaid ? c.mutedForeground : c.success }]}>
                          {bill.is_debt ? "Record payment" : isPaid ? "Unpay" : "Mark Paid"}
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
                      {bill.is_debt ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open Activity to record ${bill.name} payment`}
                          onPress={openDebtPaymentActivity}
                          style={[styles.fieldInput, { backgroundColor: c.primary + "14", justifyContent: "center" }]}
                        >
                          <Text numberOfLines={1} style={[styles.quickPaidText, { color: c.primary }]}>Use Activity</Text>
                        </Pressable>
                      ) : (
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
                      )}
                    </View>
                    <View style={styles.amtField}>
                      <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>Left</Text>
                      <View style={[styles.leftBox, { backgroundColor: remaining > 0 ? c.destructive + "15" : c.success + "15" }]}>
                        <Text style={[styles.leftText, { color: remaining > 0 ? c.destructive : c.success }]}>${remaining.toFixed(2)}</Text>
                      </View>
                    </View>
                  </View>

                  {(bill.frequency === "monthly" || bill.frequency === "quarterly") && (
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
        <ScrollView
          style={[styles.calFixed, isDesktop && styles.desktopCalFixed]}
          contentContainerStyle={[styles.calScrollContent, { paddingBottom: isDesktop ? 24 : insets.bottom + 108 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.calInner, isDesktop && styles.desktopCalInner]}>
            <View {...(Platform.OS === "web" ? {} : calendarSwipeResponder.panHandlers)}>
              <CalendarView
                month={month}
                year={selectedYear}
                transactions={calendarDataReady ? calendarTransactions : []}
                selectedDate={selectedDate}
                onDayPress={(date) => setSelectedDate(date)}
                dailyBalances={calendarDataReady ? dailyBalances : []}
                goals={calendarDataReady ? goals : []}
                decisions={calendarDataReady ? decisions : []}
                safetyFloor={settings.safety_floor}
                startDate={settings.calendar_start_date ?? settings.starting_balance_date}
                overdueBillOccurrenceKeys={overdueBillOccurrenceKeys}
              />
            </View>

            <Modal
              visible={selectedDate !== null}
              animationType="fade"
              transparent
              onRequestClose={() => dayConfirmation ? setDayConfirmation(null) : setSelectedDate(null)}
            >
              <Pressable style={[styles.dayOverlayBackdrop, isDesktop && DESKTOP_MODAL_OVERLAY]} onPress={() => setSelectedDate(null)}>
                <Pressable
                  style={[
                    styles.dayOverlayCard,
                    isDesktop && DESKTOP_MODAL_WIDE,
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
                      <View style={styles.dayOverlayDateCopy}>
                        <Text
                          accessibilityLabel={selectedDate ? formatLongDate(selectedDate) : undefined}
                          numberOfLines={2}
                          style={[styles.dayOverlayTitle, { color: c.foreground }]}
                        >
                          {selectedDate
                            ? isNarrowForecastLayout
                              ? formatCompactOverlayDate(selectedDate)
                              : formatLongDate(selectedDate)
                            : ""}
                        </Text>
                        <Text style={[styles.dayOverlaySub, { color: c.mutedForeground }]}>
                          {selectedDayItemCount} item{selectedDayItemCount === 1 ? "" : "s"}
                          {selectedForecastDay ? ` · ${selectedForecastDay.balanceSource === "actual_close" ? "actual bank close" : "closing balance"} $${selectedForecastDay.balance.toFixed(2)}` : ""}
                        </Text>
                      </View>
                    </View>
                    <Pressable onPress={() => setSelectedDate(null)} hitSlop={8}>
                      <Feather name="x" size={22} color={c.mutedForeground} />
                    </Pressable>
                  </View>

                  <ScrollView style={styles.dayOverlayScroll} contentContainerStyle={styles.dayOverlayScrollContent} showsVerticalScrollIndicator={isDesktop}>
                    {selectedForecastDay && selectedForecastDay.balance < settings.safety_floor ? (
                      <View style={[styles.dayOverlayRisk, { backgroundColor: selectedForecastDay.balance < 0 ? c.destructive + "14" : c.warning + "16", borderColor: selectedForecastDay.balance < 0 ? c.destructive + "70" : c.warning + "70" }]}>
                        <Feather name="alert-triangle" size={16} color={selectedForecastDay.balance < 0 ? c.destructive : c.warning} />
                        <Text style={[styles.dayOverlayRiskText, { color: c.foreground }]}>
                          {selectedForecastDay.balanceSource === "actual_close"
                            ? `Actual bank close was below your $${settings.safety_floor.toFixed(0)} safety floor.`
                            : `Below your $${settings.safety_floor.toFixed(0)} safety floor.`}
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
                                onPress={() => handleDeleteIncomeFromDay(item.income, item.day)}
                                style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="trash-2" size={13} color={c.destructive} />
                                <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Remove date</Text>
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
                          const occurrenceDate = selectedDate ?? isoDateForMonthDay(selectedYear, month, selectedDay ?? 1);
                          const pendingMatch = pendingPlanMatchForOccurrence(
                            pendingPlanMatches,
                            pendingBankTransactions,
                            bill.id,
                            occurrenceDate,
                          );
                          const overdueOccurrence = overdueBillOccurrenceMap.get(occurrenceKey(bill.id, occurrenceDate));
                          const amount = getAmount(bill, month, selectedYear);
                          const exactMatch = billOccurrenceMatches.get(occurrenceKey(bill.id, occurrenceDate));
                          const monthlyOverride = overrides.find(item => item.bill_id === bill.id && item.month === month && item.year === selectedYear);
                          const occurrencePayment = resolveBillOccurrencePayment({
                            occurrenceDate,
                            scheduledAmount: amount,
                            frequency: bill.frequency,
                            match: exactMatch,
                            monthlyPaidAmount: getPaidAmount(bill.id, month, selectedYear),
                            monthlyPaidDate: monthlyOverride?.paid_date,
                          });
                          const paid = occurrencePayment.paidAmount;
                          const isPaid = occurrencePayment.isPaid;
                          const isPartial = occurrencePayment.isPartial;
                          const remaining = occurrencePayment.remainingAmount;
                          const movedIn = movedInByBillId.get(bill.id);
                          const canReschedule = bill.frequency === "monthly" || bill.frequency === "quarterly";
                          const amtKey = `${bill.id}-${occurrenceDate}-overlay-amount`;
                          const showAmt = editingAmounts[amtKey] !== undefined ? editingAmounts[amtKey] : amount.toFixed(2);
                          const amountEditing = editingAmounts[amtKey] !== undefined;
                          const paidKey = `${bill.id}-${occurrenceDate}-overlay-paid`;
                          const showPaid = editingPaid[paidKey] !== undefined ? editingPaid[paidKey] : paid > 0 ? paid.toFixed(2) : "";
                          const paidEditing = editingPaid[paidKey] !== undefined;
                          return (
                            <View key={`overlay-bill-${bill.id}`} style={[styles.dayBillCard, {
                              backgroundColor: c.muted,
                              borderColor: isPaid
                                ? c.success + "40"
                                : pendingMatch
                                  ? "#3b82f660"
                                  : overdueOccurrence
                                    ? c.destructive + "70"
                                    : isPartial
                                      ? c.warning + "45"
                                      : c.border,
                            }]}>
                              <View style={styles.dayBillTop}>
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={[styles.dayBillName, { color: c.foreground }]}>{bill.name}</Text>
                                  <Text style={[styles.dayBillMeta, { color: c.mutedForeground }]}>
                                    {bill.category}{bill.is_debt ? " · debt" : ""} · {FREQ_LABELS[bill.frequency] ?? bill.frequency}{movedIn ? ` · moved from ${formatShortDate(movedIn.from_date)}` : ""}
                                  </Text>
                                </View>
                                <PayStatus
                                  paid={isPaid}
                                  partial={isPartial}
                                  overdue={Boolean(overdueOccurrence)}
                                  scheduledLabel={occurrenceDate > todayIsoDate() ? bill.is_debt ? "Debt" : "Bill" : undefined}
                                  pendingLabel={pendingMatch ? pendingMatchStatusLabel(pendingMatch) : undefined}
                                />
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
                                  {bill.is_debt ? (
                                    <Pressable
                                      accessibilityRole="button"
                                      accessibilityLabel={`Open Activity to record ${bill.name} payment`}
                                      onPress={openDebtPaymentActivity}
                                      style={styles.dayBillPaidInputRow}
                                    >
                                      <Feather name="activity" size={12} color={c.primary} />
                                      <Text numberOfLines={1} style={[styles.dayBillPaidInput, { color: c.primary }]}>Activity</Text>
                                    </Pressable>
                                  ) : (
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
                                  )}
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: remaining > 0 ? c.destructive : c.success }]}>${remaining.toFixed(2)}</Text>
                                </View>
                              </View>
                              <View style={styles.dayBillActions}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={bill.is_debt ? `Record ${bill.name} payment in Activity` : isPaid ? `Mark ${bill.name} unpaid` : `Mark ${bill.name} paid`}
                                  onPress={bill.is_debt ? openDebtPaymentActivity : () => handleQuickPaid(bill.id, amount, isPaid)}
                                  style={({ pressed }) => [styles.dayBillAction, { backgroundColor: bill.is_debt ? c.primary + "16" : isPaid ? c.background : c.success + "20", borderColor: bill.is_debt ? c.primary + "35" : isPaid ? c.border : c.success + "35", opacity: pressed ? 0.74 : 1 }]}
                                >
                                  <Feather name={bill.is_debt ? "activity" : isPaid ? "x" : "check"} size={13} color={bill.is_debt ? c.primary : isPaid ? c.mutedForeground : c.success} />
                                  <Text style={[styles.dayBillActionText, { color: bill.is_debt ? c.primary : isPaid ? c.mutedForeground : c.success }]}>{bill.is_debt ? "Record payment" : isPaid ? "Unpay" : "Mark paid"}</Text>
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

                    {selectedDebtPayments.length > 0 || selectedSnowballTransactions.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Planned debt payments</Text>
                        {selectedDebtPayments.map(payment => {
                          const savedPayment = payment.event.debtPlanSource === "canonical"
                            ? undefined
                            : extraPayments.find(item => item.id === payment.event.sourceId);
                          const amount = Math.abs(payment.event.amount);
                          const applied = payment.statusLabel.toLowerCase() === "applied";
                          const allocatedDebtIds = new Set(savedPayment?.allocations.map(allocation => allocation.billId) ?? []);
                          const displayedDebtIds = payment.event.debtTargetBillId
                            ? new Set([payment.event.debtTargetBillId])
                            : allocatedDebtIds;
                          const requiredMinimum = savedPayment
                            ? bills
                              .filter(bill => bill.is_debt && displayedDebtIds.has(bill.id))
                              .reduce(
                                (total, bill) => total + requiredDebtPlanTotal(
                                  bill,
                                  getBillOccurrencesInMonth(bill, savedPayment.month, savedPayment.year).length,
                                ),
                                0,
                              )
                            : undefined;
                          const paymentDate = savedPayment?.payment_date ?? payment.event.date;
                          const snowballMonthToDate = payment.event.id.startsWith("combined:") && requiredMinimum !== undefined
                            ? Math.max(0, amount - requiredMinimum)
                            : snowballPlanTotalThroughDate(snowballPlanEntries, paymentDate);
                          const editorParams = plannedDebtEditorParams(payment.event);
                          const canInlineEdit = Boolean(editorParams
                            && payment.event.debtTargetBillId === editorParams.billId
                            && payment.statusLabel.toLowerCase() !== "payment pending");
                          const sourceGroupTotal = (allocations: NonNullable<typeof selectedMonthFullDebtPlan>["allocations"] | undefined) =>
                            (allocations ?? [])
                              .filter(allocation => allocation.kind !== "extra"
                                && allocation.sourceBillId === editorParams?.billId
                                && allocation.date === editorParams?.date)
                              .reduce((total, allocation) => total + allocation.amount, 0);
                          const originalPlannedForOccurrence = editorParams
                            ? sourceGroupTotal(selectedMonthFullDebtPlan?.allocations)
                            : 0;
                          const remainingForOccurrence = editorParams
                            ? sourceGroupTotal(selectedMonthRemainingDebtPlan?.allocations)
                            : 0;
                          const settledForOccurrence = editorParams
                            ? Math.max(0, originalPlannedForOccurrence - remainingForOccurrence)
                            : 0;
                          const sourceDebt = editorParams
                            ? bills.find(bill => bill.is_debt && bill.id === editorParams.billId)
                            : undefined;
                          const retainedPayment = sourceDebt
                            && payment.event.debtTargetBillId === editorParams?.billId
                            ? retainedDebtPaymentBreakdown(
                              amount,
                              requiredDebtPlanTotal(sourceDebt),
                              settledForOccurrence,
                            )
                            : null;
                          return (
                            <CalendarDebtPaymentCard
                              key={`overlay-debt-${payment.event.id}`}
                              name={payment.label.replace(/ debt payment$/i, "")}
                              amount={amount}
                              applied={applied}
                              statusLabel={forecastItemBadgeLabel(payment.event, payment.statusLabel)}
                              paymentType={forecastItemTypeLabel(payment.event)}
                              requiredMinimum={requiredMinimum}
                              snowballMonthToDate={snowballMonthToDate}
                              onEdit={savedPayment ? () => {
                                setSelectedDate(null);
                                router.push({
                                  pathname: "/snowball-plan",
                                  params: { paymentId: savedPayment.id },
                                } as never);
                              } : editorParams && !canInlineEdit ? () => {
                                openPlannedDebtPaymentEditor(payment.event);
                              } : undefined}
                              inlineEdit={editorParams && canInlineEdit ? {
                                canEdit: canEditHousehold,
                                alreadyPaid: settledForOccurrence,
                                originalPlanned: originalPlannedForOccurrence,
                                onSave: async remainingAmount => {
                                  await setPlannedDebtAmount(
                                    editorParams.billId,
                                    month,
                                    selectedYear,
                                    configuredDebtAmountForRemainingPayment(remainingAmount, settledForOccurrence),
                                  );
                                },
                              } : undefined}
                              retainedPayment={retainedPayment}
                              onRemove={savedPayment && !hasBucketRemainderFunding(savedPayment.sources) ? async () => {
                                await removeDebtSnowballPayment(savedPayment.month, savedPayment.year);
                                setSelectedDate(null);
                              } : undefined}
                            />
                          );
                        })}
                        {selectedSnowballTransactions.map(transaction => {
                          const reviewedSnowballAllocation = transaction.review_resolution === "snowball"
                            ? transaction.review_allocations?.find(allocation => allocation.type === "extra_principal")
                            : undefined;
                          const debtId = reviewedSnowballAllocation?.targetId
                            ?? transaction.debt_applied_bill_id
                            ?? transaction.linked_bill_id;
                          const debt = bills.find(bill => bill.is_debt && bill.id === debtId);
                          const amount = Math.abs(Number(transaction.amount));
                          const scheduledPlan = isScheduledSnowballPlanTransaction(transaction);
                          const reviewedSnowball = transaction.review_resolution === "snowball";
                          const applied = reviewedSnowball
                            || (!scheduledPlan && Number(transaction.debt_applied_amount ?? 0) > 0.005);
                          const requiredMinimum = debt
                            ? requiredDebtPlanTotal(
                                debt,
                                getBillOccurrencesInMonth(debt, month, selectedYear).length,
                              )
                            : undefined;
                          const name = reviewedSnowballAllocation?.name
                            ?? snowballPaymentName(transaction, debt?.name ?? "Debt payment");
                          const snowballMonthToDate = scheduledPlan
                            ? snowballPlanTotalThroughDate(snowballPlanEntries, transaction.date)
                            : amount;
                          return (
                            <CalendarDebtPaymentCard
                              key={`overlay-snowball-tx-${transaction.id}`}
                              name={name}
                              amount={amount}
                              applied={applied}
                              statusLabel={applied ? "Applied" : "Snowball"}
                              paymentType="Snowball"
                              requiredMinimum={requiredMinimum}
                              snowballMonthToDate={snowballMonthToDate}
                              onEdit={reviewedSnowball ? undefined : () => {
                                setSelectedDate(null);
                                router.push({
                                  pathname: "/snowball-plan",
                                  params: { transactionId: transaction.id },
                                } as never);
                              }}
                              onRemove={reviewedSnowball ? undefined : async () => {
                                await deleteTransaction(transaction.id);
                                setSelectedDate(null);
                              }}
                            />
                          );
                        })}
                      </View>
                    ) : null}

                    {displayedGoalsForSelectedDay.length > 0 || plansForSelectedDay.length > 0 ? (
                      <View style={[styles.dayOverlaySection, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Text style={[styles.dayOverlaySectionTitle, { color: c.foreground }]}>Plans & goals</Text>
                        {displayedGoalsForSelectedDay.map(goal => (
                          <View key={`overlay-goal-${goal.id}`} style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: "#3b82f666" }]}>
                            <View style={styles.dayOverlayRow}>
                              <Text numberOfLines={1} style={[styles.dayOverlayRowName, { color: c.foreground }]}>★ {goal.name}</Text>
                              <Text style={[styles.dayOverlayAmount, { color: "#3b82f6" }]}>-${goal.amount.toFixed(2)}</Text>
                            </View>
                            <View style={styles.dayBillActions}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Edit ${goal.name} bucket`}
                                onPress={() => openEditBucket(goal.id)}
                                style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="edit-2" size={13} color={c.primary} />
                                <Text style={[styles.dayBillActionText, { color: c.primary }]}>Edit</Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Delete ${goal.name} bucket`}
                                onPress={() => handleDeleteGoalFromDay(goal.id, goal.name)}
                                style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                              >
                                <Feather name="trash-2" size={13} color={c.destructive} />
                                <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Delete</Text>
                              </Pressable>
                            </View>
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
                              style={[styles.dayBillCard, { backgroundColor: c.muted, borderColor: "#3b82f666" }]}
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
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: c.foreground }]}>${group.plannedAmount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Spent</Text>
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: c.success }]}>${group.spentAmount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>{finalLabel}</Text>
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: statusColor }]}>${finalAmount.toFixed(2)}</Text>
                                </View>
                              </View>
                              {group.source === "goal" ? (
                                <View style={styles.dayBillActions}>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Edit ${group.name} bucket`}
                                    onPress={() => openEditBucket(group.targetId)}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.primary + "16", borderColor: c.primary + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="edit-2" size={13} color={c.primary} />
                                    <Text style={[styles.dayBillActionText, { color: c.primary }]}>Edit</Text>
                                  </Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Delete ${group.name} bucket`}
                                    onPress={() => handleDeleteGoalFromDay(group.targetId, group.name)}
                                    style={({ pressed }) => [styles.dayBillAction, { backgroundColor: c.destructive + "12", borderColor: c.destructive + "35", opacity: pressed ? 0.74 : 1 }]}
                                  >
                                    <Feather name="trash-2" size={13} color={c.destructive} />
                                    <Text style={[styles.dayBillActionText, { color: c.destructive }]}>Delete</Text>
                                  </Pressable>
                                </View>
                              ) : null}
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
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: c.foreground }]}>${settlement.amount.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>{isTransfer ? "Moved" : isMoneyIn ? "Received" : "Paid"}</Text>
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: c.success }]}>${settlement.paid.toFixed(2)}</Text>
                                </View>
                                <View style={[styles.dayBillNumberTile, { backgroundColor: c.background + "66" }]}>
                                  <Text style={[styles.dayBillNumberLabel, { color: c.mutedForeground }]}>Left</Text>
                                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={[styles.dayBillNumberValue, { color: remaining > 0.005 ? c.warning : c.success }]}>${remaining.toFixed(2)}</Text>
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
                <ConfirmActionOverlay request={dayConfirmation} onClose={() => setDayConfirmation(null)} />
              </Pressable>
            </Modal>

          </View>
        </ScrollView>
      )}
        </>
      )}

      <Modal
        visible={monthSearchVisible}
        animationType="fade"
        transparent
        onRequestClose={closeMonthSearch}
      >
        <Pressable style={[styles.monthSearchBackdrop, isDesktop && DESKTOP_MODAL_OVERLAY]} onPress={closeMonthSearch}>
          <Pressable
            onPress={event => event.stopPropagation()}
            style={[
              styles.monthSearchSheet,
              isDesktop && DESKTOP_MODAL_WIDE,
              {
                backgroundColor: c.isDark ? "rgba(15,23,42,0.98)" : "rgba(255,255,255,0.98)",
                borderColor: c.border,
              },
            ]}
          >
            <View style={styles.monthSearchHeader}>
              <View>
                <Text style={[styles.monthSearchEyebrow, { color: c.primary }]}>Forecast search</Text>
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
        <Pressable style={[styles.pickerOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]} onPress={() => setDueDayPicker(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_REGULAR]} onPress={e => e.stopPropagation()}>
            {dueDayPicker && (() => {
              const { bill, fromDate } = dueDayPicker;
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const movedDate = getBillDateMoveForOccurrence(bill.id, fromDate)?.to_date;
              const effectiveDate = movedDate ?? fromDate;
              const effectiveDay = dayFromIsoDate(effectiveDate);
              const originalDay = dayFromIsoDate(fromDate);
              return (
                <>
                  <View style={[styles.pickerHandle, isDesktop && DESKTOP_MODAL_HANDLE]} />
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
        <Pressable style={[styles.pickerOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]} onPress={() => setIncomeDatePicker(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_REGULAR]} onPress={e => e.stopPropagation()}>
            {incomeDatePicker && (() => {
              const daysInMonth = new Date(selectedYear, month + 1, 0).getDate();
              const effectiveDay = incomeDatePicker.day;
              return (
                <>
                  <View style={[styles.pickerHandle, isDesktop && DESKTOP_MODAL_HANDLE]} />
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
      <GoalModal
        visible={Boolean(editingBucket)}
        onClose={() => setEditingBucket(null)}
        onSave={async data => {
          if ("id" in data) await updateGoal(data as Goal);
        }}
        onDelete={deleteGoal}
        editGoal={editingBucket}
        initialMode="budget"
      />
      <DebtPaymentAppliedModal
        visible={!!debtPaymentNotice}
        detail={debtPaymentNotice}
        onClose={() => setDebtPaymentNotice(null)}
      />
      <Modal
        visible={editPlan !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditPlan(null)}
      >
        <Pressable style={[styles.pickerOverlay, isDesktop && DESKTOP_MODAL_OVERLAY]} onPress={() => setEditPlan(null)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_REGULAR]} onPress={e => e.stopPropagation()}>
            <View style={[styles.pickerHandle, isDesktop && DESKTOP_MODAL_HANDLE]} />
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
        method="snowball"
        preview={snowballPreview}
        amount={extraPayment}
        existingPayment={!!getExtraPayment(month, selectedYear)}
        paymentDateMinimumReason={latestBucketRemainderAvailableDate(getExtraPayment(month, selectedYear)?.sources)
          ? `Includes bucket money available ${latestBucketRemainderAvailableDate(getExtraPayment(month, selectedYear)?.sources)}. Reopen the bucket before removing that source.`
          : undefined}
        safetyFloor={settings.safety_floor}
        forecastHorizonMonths={settings.forecast_horizon_months}
        onAmountChange={updateSnowballAmount}
        onClose={() => setSnowballModalVisible(false)}
        onConfirm={confirmSnowballPayment}
        onRemove={() => void removeSavedSnowballPayment()}
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
        routeMode={surplusRouteMode}
        nextPaymentDate={surplusSnowballOffer?.nextPayment?.date}
        nextPaymentAmount={surplusSnowballOffer?.nextPayment?.amount}
        onRouteModeChange={setSurplusRouteMode}
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingHorizontal: 22, paddingBottom: 14 },
  desktopHeader: { width: "96%", maxWidth: 1440, alignSelf: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  narrowHeader: { gap: 8, paddingHorizontal: 14 },
  stackedHeader: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  stackedHeaderCopy: { width: "100%" },
  calendarBrand: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 2.2, marginBottom: 3, textTransform: "uppercase" },
  calendarScreenLabel: { fontSize: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9 },
  forecastTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  narrowHeaderActions: { gap: 6 },
  stackedHeaderActions: { alignSelf: "flex-end" },
  simulatorButton: { minHeight: 46, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  narrowSimulatorButton: { width: 44, height: 44, minHeight: 44, borderRadius: 15, paddingHorizontal: 0 },
  simulatorButtonText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  todayChip: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  narrowTodayChip: { width: 44, height: 44, borderRadius: 14 },
  todayChipText: { fontSize: 17, fontFamily: "Inter_800ExtraBold", lineHeight: 20 },
  calendarMonthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 22, marginTop: 0, marginBottom: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", backgroundColor: "rgba(2,6,23,0.32)", borderRadius: 26, paddingHorizontal: 10, paddingVertical: 11 },
  desktopMonthBar: { width: "96%", maxWidth: 1440, alignSelf: "center", marginHorizontal: 0 },
  monthArrowBtn: { width: 46, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "rgba(15,23,42,0.58)" },
  monthCenterLabel: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  monthCenterPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
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
  entryCard: { marginBottom: 12, borderLeftWidth: 4, borderWidth: 1, borderColor: "rgba(148,163,184,0.10)", shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.10, shadowRadius: 14, elevation: 3 },
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
  calFixed: { flex: 1, paddingTop: 8 },
  calScrollContent: { flexGrow: 1 },
  calInner: { paddingHorizontal: 12 },
  desktopCalFixed: { paddingTop: 0 },
  desktopCalInner: { width: "96%", maxWidth: 1440, alignSelf: "center", paddingHorizontal: 0 },
  weeklyChip: { flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 12, marginTop: 2, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  weeklyChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
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
  dayOverlayDateBlock: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  dayOverlayDateCopy: { flex: 1, minWidth: 0 },
  dayOverlayBigDay: { fontSize: 34, fontFamily: "Inter_700Bold", lineHeight: 40 },
  dayOverlayTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  dayOverlaySub: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  dayOverlayScroll: { maxHeight: 470 },
  dayOverlayScrollContent: { gap: 10, paddingBottom: 8 },
  dayOverlayRisk: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 16, padding: 12 },
  dayOverlayRiskText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  dayOverlaySection: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  dayOverlaySectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
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
  dayBillNumberTile: { flex: 1, minWidth: 0, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 8 },
  dayBillNumberLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  dayBillNumberValue: { maxWidth: "100%", fontSize: 13, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  dayDebtPlanSummary: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  dayDebtPlanText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dayDebtPlanTotal: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  dayDebtPlanNote: { fontSize: 10, fontFamily: "Inter_500Medium" },
  dayDebtBadgeRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dayDebtInfoButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  retainedDebtInfo: { borderWidth: 1, borderRadius: 12, padding: 11, gap: 5 },
  retainedDebtInfoTitle: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  retainedDebtInfoText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  retainedDebtInfoHighlight: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_700Bold" },
  inlineDebtEditor: { borderWidth: 1, borderRadius: 13, padding: 11, gap: 7 },
  inlineDebtEditorLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
  inlineDebtEditorInputWrap: { minHeight: 48, borderWidth: 1.5, borderRadius: 12, flexDirection: "row", alignItems: "center" },
  inlineDebtEditorDollar: { fontSize: 18, fontFamily: "Inter_700Bold", paddingLeft: 12 },
  inlineDebtEditorInput: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 7, fontSize: 18, fontFamily: "Inter_800ExtraBold", outlineStyle: "none" as never },
  inlineDebtEditorCopy: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16 },
  inlineDebtEditorSuggestion: { minHeight: 44, alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  inlineDebtEditorSuggestionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  inlineDebtEditorTotal: { fontSize: 11, fontFamily: "Inter_700Bold" },
  inlineDebtEditorError: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  inlineDebtEditorActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  inlineDebtEditorButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  inlineDebtEditorButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
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
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#555", alignSelf: "center", marginBottom: 16 },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  pickerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  pickerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
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

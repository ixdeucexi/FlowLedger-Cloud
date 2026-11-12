import { usePrivacyAlerts } from "@/hooks/usePrivacyAlerts";
import { parseMoneyInput, parseDecimalInput } from "@/lib/moneyFormInput";
import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "@/lib/haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyTextInput as TextInput, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";

import colors from "@/constants/colors";
import { ConfirmActionOverlay } from "@/components/ConfirmActionModal";
import { AccountForecastPicker } from "@/components/AccountForecastPicker";
import type { ForecastAccountRef } from "@/lib/accountForecasts";
import { BillFrequencyPicker } from "@/components/BillFrequencyPicker";
import { BillPaymentHistoryPanel } from "@/components/BillPaymentHistoryPanel";
import { DebtPaymentPauseModal, type DebtPaymentPauseDateField, type DebtPaymentPauseInput, type DebtPaymentPauseStep } from "@/components/DebtPaymentPauseModal";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import { PlannedTransferModal, type PlannedTransferInitialValues } from "@/components/PlannedTransferModal";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useLocalDay } from "@/hooks/useLocalDay";
import { localDateInTimeZone } from "@/lib/dailyCheckingClose";
import { activeDebtPaymentPause, type DebtPaymentPause } from "@/lib/debtPaymentPause";
import { DESKTOP_MODAL_HANDLE, DESKTOP_MODAL_OVERLAY, DESKTOP_MODAL_WIDE } from "@/lib/desktopModal";
import type { ConfirmActionOptions } from "@/lib/confirmAction";
import { MONTH_NAMES, dateOnlyToLocalDate } from "@/lib/dateLabels";
import { BILL_IMPORTANCE_OPTIONS, normalizeBillImportance, type BillImportance } from "@/lib/billImportance";
import {
  billEditablePatch,
  changedBillEditableFields,
  type BillEditableBaseline,
  type BillEditableField,
} from "@/lib/billEditPersistence";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface AddBillInitialValues {
  name?: string;
  amount?: number;
  category?: string;
  dueDay?: number;
  nextPaymentDate?: string;
  startDate?: string;
  isRecurring?: boolean;
  frequency?: Bill["frequency"];
  smartPriority?: BillImportance;
  fundingAccountRef?: ForecastAccountRef | null;
}

interface AddBillModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (
    bill: Omit<Bill, "id" | "created_at"> | Bill,
    dirtyFields?: readonly BillEditableField[],
    baseline?: BillEditableBaseline,
  ) => void | Promise<unknown>;
  onDelete?: (id: string) => void | Promise<unknown>;
  onStopFuture?: (id: string) => void | Promise<unknown>;
  onResume?: (id: string) => void | Promise<unknown>;
  onDeleteMistake?: (id: string) => void | Promise<unknown>;
  editBill?: Bill | null;
  forceDebt?: boolean;
  initialValues?: AddBillInitialValues;
  title?: string;
  saveLabel?: string;
}

export function AddBillModal({ visible, onClose, onSave, onDelete, onStopFuture, onResume, onDeleteMistake, editBill, forceDebt, initialValues, title, saveLabel }: AddBillModalProps) {
  const privacyAlerts = usePrivacyAlerts();
  const c = useColors();
  const { user } = useAuth();
  const isDesktop = useDesktopExperience();
  const { bills, categories, settings, activeHousehold, canEditHousehold, householdTimeZone, pauseDebtPayments, editDebtPaymentPause, resumeDebtPayments, forecastAccounts, accountForecastReady, selectedForecastAccountRef, plannedAccountTransfers, plannedTransfersReady, plannedTransfersError, retryBudgetLoad, demoMode } = useBudget();
  useLocalDay();
  const today = localDateInTimeZone(new Date(), householdTimeZone);
  const convertedPlan = editBill ? plannedAccountTransfers.find(plan => plan.source_bill_id === editBill.id) : undefined;
  const statusUnverified = Boolean(editBill && !editBill.is_debt && !demoMode && !plannedTransfersReady);
  const historyOnly = Boolean(convertedPlan) || statusUnverified;
  const currentDebt = editBill?.is_debt ? bills.find(bill => bill.id === editBill.id && bill.is_debt) : undefined;
  const activePause = activeDebtPaymentPause(currentDebt, today);
  const upcomingPause = currentDebt?.debt_payment_pauses?.filter(pause => pause.start_date > today).sort((left, right) => left.start_date.localeCompare(right.start_date))[0];
  const paymentPause = activePause ?? upcomingPause;
  const pauseUnavailable = !canEditHousehold ? "Only household editors can pause debt payments."
    : !currentDebt || currentDebt.balance <= 0.009 || Boolean(currentDebt.end_date) ? "Payment pauses are available for open debts with a balance." : "";
  const pauseScopeKey = `${activeHousehold?.householdId ?? "local"}:${activeHousehold?.budgetId ?? "local"}`;
  const pauseAccessRef = useRef({ scopeKey: pauseScopeKey, canEdit: canEditHousehold, visible, billId: editBill?.id });

  const [name,          setName]          = useState("");
  const [amount,        setAmount]        = useState("");
  const [category,      setCategory]      = useState("Other");
  const [isDebt,        setIsDebt]        = useState(false);
  const [balance,       setBalance]       = useState("");
  const [interestRate,  setInterestRate]  = useState("");
  const [fundingAccountRef, setFundingAccountRef] = useState<ForecastAccountRef | null>(null);
  const formScopeRef = useRef<string | null>(visible ? pauseScopeKey : null);
  useEffect(() => {
    if (!visible) formScopeRef.current = null;
    else if (formScopeRef.current === null) formScopeRef.current = pauseScopeKey;
  }, [visible, pauseScopeKey]);
  const [includeInSnowball, setIncludeInSnowball] = useState(true);
  const [smartPriority, setSmartPriority] = useState<BillImportance>("must");
  const [dueDay,        setDueDay]        = useState("1");
  const [dayOfWeek,     setDayOfWeek]     = useState(0);      // 0=Sun … 6=Sat
  const [isRecurring,   setIsRecurring]   = useState(true);
  const [frequency,     setFrequency]     = useState<Bill["frequency"]>("monthly");
  const [frequencyOpen, setFrequencyOpen] = useState(false);
  const [nextPaymentDate, setNextPaymentDate] = useState("");
  const [billStartDate, setBillStartDate] = useState("");     // YYYY-MM-DD
  const [billEndDate,   setBillEndDate]   = useState("");     // YYYY-MM-DD
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [pickerYear,    setPickerYear]    = useState(() => new Date().getFullYear());
  const [pickerMonth,   setPickerMonth]   = useState(() => new Date().getMonth());
  const [saving,         setSaving]        = useState(false);
  const transferScopeKey = `${user?.id ?? "demo"}:${pauseScopeKey}`;
  const [transferFlow, setTransferFlow] = useState<{
    scope: string;
    bill: Bill | null;
    initialValues: PlannedTransferInitialValues;
  } | null>(null);
  useEffect(() => {
    if (!visible) setTransferFlow(null);
    else if (transferFlow && transferFlow.scope !== transferScopeKey) {
      setTransferFlow(null);
      onClose();
    }
  }, [visible, transferScopeKey, transferFlow?.scope]);
  const [confirmation, setConfirmation] = useState<ConfirmActionOptions | null>(null);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [pauseVisible, setPauseVisible] = useState(false);
  const [editingPaymentPause, setEditingPaymentPause] = useState<DebtPaymentPause | undefined>();
  const [pauseDraftRevision, setPauseDraftRevision] = useState(0);
  const [pauseDateField, setPauseDateField] = useState<DebtPaymentPauseDateField>(null);
  const [pauseStep, setPauseStep] = useState<DebtPaymentPauseStep>("dates");
  const [pauseActionSaving, setPauseActionSaving] = useState(false);
  const [pauseActionError, setPauseActionError] = useState("");
  const [pauseBackRevision, setPauseBackRevision] = useState(0);
  const pausePendingRef = useRef(false);
  const pauseDraftRef = useRef({ visible: pauseVisible, revision: pauseDraftRevision });
  pauseDraftRef.current = { visible: pauseVisible, revision: pauseDraftRevision };
  pauseAccessRef.current = { scopeKey: pauseScopeKey, canEdit: canEditHousehold, visible, billId: editBill?.id };
  const dismissLayer = () => {
    if (frequencyOpen) { setFrequencyOpen(false); return; }
    if (confirmation) { setConfirmation(null); return; }
    if (pauseVisible) {
      if (pausePendingRef.current) { setPauseBackRevision(revision => revision + 1); return; }
      if (pauseDateField) setPauseDateField(null);
      else if (pauseStep === "transfer") setPauseStep("dates");
      else setPauseVisible(false);
      return;
    }
    if (historyVisible) setHistoryVisible(false);
    else onClose();
  };
  // A refused browser Back has consumed its nested entry; a new revision
  // asks the existing controller to restore that owned entry while saving.
  useBackDismiss(visible && !transferFlow, dismissLayer, true, pauseVisible ? (pauseDateField || pauseStep === "transfer" ? 2 : 1) + pauseBackRevision * 3 : historyVisible || frequencyOpen ? 1 : 0);

  useEffect(() => {
    setPauseVisible(false);
    setEditingPaymentPause(undefined);
    setPauseDateField(null);
    setPauseStep("dates");
    setPauseActionError("");
  }, [editBill?.id, currentDebt?.id, visible, pauseScopeKey]);

  useEffect(() => { setFrequencyOpen(false); }, [visible, editBill?.id, pauseScopeKey, isDebt, forceDebt]);

  const beginPaymentPause = (selected?: DebtPaymentPause) => {
    if (pausePendingRef.current || saving || pauseUnavailable) return;
    Keyboard.dismiss();
    setFrequencyOpen(false);
    setActionMenuVisible(false);
    // Keep the selected interval as the edit baseline through refreshes/retries.
    setEditingPaymentPause(selected ? Object.freeze({
      id: selected.id,
      start_date: selected.start_date,
      resume_date: selected.resume_date,
      redirect_payment: selected.redirect_payment,
    }) : undefined);
    setPauseDraftRevision(revision => revision + 1);
    setPauseDateField(null);
    setPauseStep("dates");
    setPauseVisible(true);
  };
  const openPaymentPause = () => beginPaymentPause();
  const openEditPaymentPause = () => { if (paymentPause) beginPaymentPause(paymentPause); };
  const assertPauseAccess = () => {
    const latest = pauseAccessRef.current;
    if (!latest.canEdit || !latest.visible || latest.scopeKey !== pauseScopeKey || latest.billId !== editBill?.id) {
      throw new Error("Your household or editing access changed. Reopen this debt to try again.");
    }
  };
  const savePaymentPause = async (input: DebtPaymentPauseInput) => {
    assertPauseAccess();
    if (!currentDebt || pauseUnavailable) throw new Error(pauseUnavailable || "Reopen this debt to try again.");
    if (!pauseDraftRef.current.visible || pauseDraftRef.current.revision !== pauseDraftRevision) {
      throw new Error("This pause editor changed. Reopen this debt to try again.");
    }
    if (editingPaymentPause) await editDebtPaymentPause(currentDebt.id, editingPaymentPause, input);
    else await pauseDebtPayments(currentDebt.id, input);
  };
  const resumePaymentPause = async () => {
    if (saving || pausePendingRef.current || !currentDebt || !paymentPause) return;
    try {
      assertPauseAccess();
      if (pauseUnavailable) throw new Error(pauseUnavailable);
      pausePendingRef.current = true;
      setPauseActionSaving(true);
      setPauseActionError("");
      await resumeDebtPayments(currentDebt.id, paymentPause.id);
    } catch (error) {
      setPauseActionError(error instanceof Error ? error.message : "Couldn’t update this pause. Please try again.");
    } finally {
      pausePendingRef.current = false;
      setPauseActionSaving(false);
    }
  };
  const pauseDateLabel = (date: string) => dateOnlyToLocalDate(date)?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) ?? date;

  const firstDOWInDayPickerMonth = useMemo(
    () => new Date(pickerYear, pickerMonth, 1).getDay(),
    [pickerYear, pickerMonth]
  );
  const daysInDayPickerMonth = useMemo(
    () => new Date(pickerYear, pickerMonth + 1, 0).getDate(),
    [pickerYear, pickerMonth]
  );
  const shiftPickerMonth = (dir: number) => {
    setPickerMonth(m => {
      const next = m + dir;
      if (next < 0) { setPickerYear(y => y - 1); return 11; }
      if (next > 11) { setPickerYear(y => y + 1); return 0; }
      return next;
    });
  };

  const handlePaymentDateChange = (value: string) => {
    setNextPaymentDate(value);
    const [year, month, day] = value.split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return;
    const parsed = new Date(year, month - 1, day);
    setDueDay(String(day));
    setDayOfWeek(parsed.getDay());
    setPickerYear(year);
    setPickerMonth(month - 1);
  };

  useEffect(() => {
    setConfirmation(null);
    setActionMenuVisible(false);
    setHistoryVisible(false);
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.is_debt ? "Other" : editBill.category);
      setIsDebt(editBill.is_debt);
      setBalance(editBill.balance > 0 ? editBill.balance.toString() : "");
      setInterestRate(editBill.interest_rate > 0 ? editBill.interest_rate.toString() : "");
      setFundingAccountRef((editBill.funding_account_ref ?? null) as ForecastAccountRef | null);
      setIncludeInSnowball(editBill.include_in_snowball !== false);
      setSmartPriority(normalizeBillImportance(editBill.smart_priority, editBill.is_debt));
      setDueDay(editBill.due_day.toString());
      setDayOfWeek(editBill.day_of_week ?? 0);
      setIsRecurring(editBill.is_recurring);
      setFrequency(editBill.frequency ?? "monthly");
      setNextPaymentDate(editBill.next_payment_date ?? (editBill.frequency === "yearly" ? editBill.start_date : undefined) ?? "");
      setBillStartDate(editBill.start_date ?? "");
      setBillEndDate(editBill.end_date ?? "");
    } else {
      setFundingAccountRef(initialValues?.fundingAccountRef !== undefined ? initialValues.fundingAccountRef : selectedForecastAccountRef ?? null);
      const paymentDate = initialValues?.nextPaymentDate ?? "";
      const [year, month, day] = paymentDate.split("-").map(Number);
      const hasValidPaymentDate = [year, month, day].every(Number.isFinite);
      setName(initialValues?.name ?? "");
      setAmount(initialValues?.amount ? initialValues.amount.toString() : "");
      setCategory(initialValues?.category ?? "Other");
      setIsDebt(forceDebt ?? false); setBalance(""); setInterestRate(""); setIncludeInSnowball(true);
      setSmartPriority(normalizeBillImportance(initialValues?.smartPriority, forceDebt ?? false));
      setDueDay(String(initialValues?.dueDay ?? (hasValidPaymentDate ? day : 1)));
      setDayOfWeek(hasValidPaymentDate ? new Date(year, month - 1, day).getDay() : 0);
      setIsRecurring(initialValues?.isRecurring ?? true);
      setFrequency(initialValues?.frequency ?? "monthly");
      setNextPaymentDate(paymentDate);
      setBillStartDate(initialValues?.startDate ?? "");
      setBillEndDate("");
      if (hasValidPaymentDate) {
        setPickerYear(year);
        setPickerMonth(month - 1);
      }
    }
  }, [editBill, visible, forceDebt, initialValues]);

  const noun = forceDebt || isDebt ? "Debt" : "Bill";
  const conversionUnavailable = !editBill ? ""
    : editBill.is_debt || isDebt ? "Debt payments stay in your debt plan. Add a separate transfer between your cash accounts."
    : editBill.end_date ? "This bill’s schedule has already ended. You can add a separate transfer."
    : editBill.is_recurring && editBill.frequency !== "monthly" ? "Changing to a transfer is available for monthly and one-time bills."
    : "";
  const openTransfer = (convert: boolean) => {
    if (saving || pausePendingRef.current || !canEditHousehold || !accountForecastReady
      || formScopeRef.current !== pauseScopeKey || (convert && (!editBill || conversionUnavailable))) return;
    Keyboard.dismiss();
    setFrequencyOpen(false);
    setActionMenuVisible(false);
    setTransferFlow({
      scope: transferScopeKey,
      // Keep the exact source snapshot through background reads and retry.
      bill: convert && editBill ? JSON.parse(JSON.stringify(editBill)) as Bill : null,
      initialValues: {
        name,
        amount,
        fromAccountRef: fundingAccountRef,
        frequency: !isRecurring ? "once" : "monthly",
      },
    });
  };

  const handleSave = async () => {
    if (saving || pausePendingRef.current || historyOnly) return;
    if (!pauseAccessRef.current.canEdit || !pauseAccessRef.current.visible || formScopeRef.current !== pauseAccessRef.current.scopeKey) {
      privacyAlerts.formError("Reopen this editor", "Your household or editing access changed. Close this editor and try again.");
      return;
    }
    if (fundingAccountRef && (!accountForecastReady || !forecastAccounts.some(account => account.ref === fundingAccountRef && account.active && !account.unavailableReason))) {
      privacyAlerts.formError("Choose a payment account", "This account is unavailable. Choose an active account or leave it unassigned.");
      return;
    }
    const parsedAmount = parseMoneyInput(amount);
    const parsedBalance = balance.trim() ? parseMoneyInput(balance) : 0;
    const parsedRate = interestRate.trim() ? parseDecimalInput(interestRate, 4) : 0;
    if (parsedAmount === null || parsedAmount <= 0 || (isDebt && (parsedBalance === null || parsedRate === null))) { privacyAlerts.formError("Check bill amounts", "Enter valid nonnegative amounts. Payment and balance allow up to two decimal places; interest rate allows up to four."); return; }
    if (!name.trim()) return;
    if (frequency === "yearly" && isDebt) {
      privacyAlerts.formError("Choose a debt payment frequency", "Yearly is available for bills. Choose another frequency before changing this bill to debt.");
      return;
    }
    if ((frequency === "quarterly" && !nextPaymentDate.trim())
      || (frequency === "yearly" && !dateOnlyToLocalDate(nextPaymentDate.trim()))) {
      privacyAlerts.formError("Choose the first payment date", frequency === "yearly" ? "FlowLedger uses it to repeat this bill once a year." : "FlowLedger uses it to repeat this bill every 3 months.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Bill, "id" | "created_at"> = {
      name: name.trim(),
      amount: parsedAmount,
      category: isDebt ? "Debt" : category,
      priority: isDebt ? 0 : 99,
      is_debt: isDebt,
      balance: isDebt ? (parsedBalance ?? 0) : 0,
      interest_rate: isDebt ? (parsedRate ?? 0) : 0,
      due_day: parseInt(dueDay) || 1,
      day_of_week: dayOfWeek,
      next_payment_date: nextPaymentDate.trim() || undefined,
      start_date: billStartDate.trim() || undefined,
      end_date: billEndDate.trim() || undefined,
      is_recurring: isDebt ? true : isRecurring,
      frequency,
      smart_priority: normalizeBillImportance(smartPriority, isDebt),
      include_in_snowball: isDebt ? includeInSnowball : false,
      funding_account_ref: fundingAccountRef,
      ...(editBill ? { debt_payment_pauses: currentDebt?.debt_payment_pauses ?? editBill.debt_payment_pauses } : {}),
    };
    setSaving(true);
    try {
      if (editBill) {
        const dirtyFields = changedBillEditableFields(editBill, data).filter(field => field !== "debt_payment_pauses");
        const baseline = billEditablePatch(editBill, dirtyFields);
        await onSave({ ...data, id: editBill.id, created_at: editBill.created_at }, dirtyFields, baseline);
      }
      else await onSave(data);
      onClose();
    } catch (error) {
      privacyAlerts.alert(`Couldn’t save ${noun.toLowerCase()}`, error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editBill || !onDelete) return;
    const doDelete = async () => {
      if (saving || !pauseAccessRef.current.canEdit || !pauseAccessRef.current.visible || formScopeRef.current !== pauseAccessRef.current.scopeKey) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSaving(true);
      try {
        await onDelete(editBill.id);
        onClose();
      } catch (error) {
        privacyAlerts.alert("Couldn’t delete", error instanceof Error ? error.message : "Please try again.");
      } finally {
        setSaving(false);
      }
    };
    setFrequencyOpen(false);
    setConfirmation({
      title: `Delete ${noun}`,
      message: `Delete "${editBill.name}" completely? This removes it from Bills and Calendar. Existing manual transactions stay in Activity.`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: doDelete,
    });
  };

  const handleStopFuture = () => {
    if (!editBill) return;
    const stopFuture = onStopFuture ?? onDeleteMistake;
    if (!stopFuture) return;
    const doStopFuture = async () => {
      if (saving || !pauseAccessRef.current.canEdit || !pauseAccessRef.current.visible || formScopeRef.current !== pauseAccessRef.current.scopeKey) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSaving(true);
      try {
        await stopFuture(editBill.id);
        onClose();
      } catch (error) {
        privacyAlerts.alert("Couldn’t stop future bill", error instanceof Error ? error.message : "Please try again.");
      } finally {
        setSaving(false);
      }
    };
    setFrequencyOpen(false);
    setConfirmation({
      title: `Pause ${noun}`,
      message: `Pause "${editBill.name}" after this month's scheduled payments? Past months and saved monthly details will stay unchanged.`,
      confirmText: "Pause",
      destructive: true,
      onConfirm: doStopFuture,
    });
  };

  const handleResume = () => {
    if (!editBill || !onResume) return;
    const doResume = async () => {
      if (saving || !pauseAccessRef.current.canEdit || !pauseAccessRef.current.visible || formScopeRef.current !== pauseAccessRef.current.scopeKey) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSaving(true);
      try {
        await onResume(editBill.id);
        onClose();
      } catch (error) {
        privacyAlerts.alert("Couldn’t resume payments", error instanceof Error ? error.message : "Please try again.");
      } finally {
        setSaving(false);
      }
    };
    setFrequencyOpen(false);
    setConfirmation({
      title: `Resume ${noun}`,
      message: `Resume "${editBill.name}" and restore its future scheduled payments?`,
      confirmText: "Resume",
      onConfirm: doResume,
    });
  };

  const nonDebtCategories = categories.filter(c => c !== "Debt");
  const inp = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl = [styles.label, { color: c.mutedForeground }];

  return (
    <>
    <Modal
      visible={visible && !transferFlow}
      animationType={isDesktop ? "fade" : "slide"}
      transparent
      onRequestClose={dismissLayer}
    >
      <KeyboardAvoidingView pointerEvents={pauseVisible ? "none" : "auto"} accessibilityElementsHidden={pauseVisible} importantForAccessibility={pauseVisible ? "no-hide-descendants" : "auto"} behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.overlay, isDesktop && DESKTOP_MODAL_OVERLAY, pauseVisible && { display: "none" }]}>
        <Pressable accessibilityLabel="Close bill editor" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.container, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_WIDE]}>
          <View style={[styles.handle, isDesktop && DESKTOP_MODAL_HANDLE]} />
          <View style={styles.header}>
            {historyVisible ? <Pressable accessibilityRole="button" accessibilityLabel="Back to bill editor" onPress={() => setHistoryVisible(false)} style={styles.historyBack}>
              <Feather name="arrow-left" size={22} color={c.foreground} />
              <Text style={[styles.title, { color: c.foreground }]}>Payment history</Text>
            </Pressable> : <Text style={[styles.title, { color: c.foreground }]}>
              {historyOnly ? "Bill history" : title ?? (editBill ? `Edit ${noun}` : `Add ${noun}`)}
            </Text>}
            <View style={styles.headerActions}>
              {editBill && !historyVisible && !historyOnly ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More bill actions"
                  accessibilityState={{ expanded: actionMenuVisible, disabled: saving || pauseActionSaving }}
                  disabled={saving || pauseActionSaving}
                  onPress={() => { setFrequencyOpen(false); setActionMenuVisible((visible) => !visible); }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerActionButton, { backgroundColor: actionMenuVisible ? c.primary + "18" : "transparent", opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="more-vertical" size={21} color={c.foreground} />
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close bill editor">
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {editBill && actionMenuVisible && !historyVisible && !historyOnly ? (
            <View style={[styles.actionMenu, { backgroundColor: c.card, borderColor: c.border }]}>
              {editBill.end_date && onResume ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Resume ${editBill.name}`}
                  onPress={() => { setActionMenuVisible(false); handleResume(); }}
                  style={({ pressed }) => [styles.actionMenuItem, { backgroundColor: pressed ? c.primary + "12" : "transparent" }]}
                >
                  <Feather name="play-circle" size={17} color={c.success} />
                  <View style={styles.actionMenuCopy}>
                    <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Resume payments</Text>
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>Restore future scheduled dates</Text>
                  </View>
                </Pressable>
              ) : null}
              {!editBill.is_debt && !editBill.end_date && (onStopFuture || onDeleteMistake) && editBill.is_recurring ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Pause ${editBill.name}`}
                  onPress={() => { setActionMenuVisible(false); handleStopFuture(); }}
                  style={({ pressed }) => [styles.actionMenuItem, { backgroundColor: pressed ? c.warning + "12" : "transparent" }]}
                >
                  <Feather name="pause-circle" size={17} color={c.warning} />
                  <View style={styles.actionMenuCopy}>
                    <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Pause bill</Text>
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>Pause after this month’s payments</Text>
                  </View>
                </Pressable>
              ) : null}
              {editBill.is_debt && !paymentPause ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pause debt payments"
                  accessibilityState={{ disabled: Boolean(pauseUnavailable) || saving || pauseActionSaving }}
                  disabled={Boolean(pauseUnavailable) || saving || pauseActionSaving}
                  onPress={openPaymentPause}
                  style={({ pressed }) => [styles.actionMenuItem, { backgroundColor: pressed ? c.warning + "12" : "transparent", opacity: pauseUnavailable || saving || pauseActionSaving ? 0.55 : 1 }]}
                >
                  <Feather name="pause-circle" size={17} color={c.warning} />
                  <View style={styles.actionMenuCopy}>
                    <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Pause debt payments</Text>
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>{pauseUnavailable || "Choose dates and keep this debt in its payoff order"}</Text>
                  </View>
                </Pressable>
              ) : null}
              {editBill.is_debt && paymentPause ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit saved payment pause"
                  accessibilityState={{ disabled: Boolean(pauseUnavailable) || saving || pauseActionSaving }}
                  disabled={Boolean(pauseUnavailable) || saving || pauseActionSaving}
                  onPress={openEditPaymentPause}
                  style={({ pressed }) => [styles.actionMenuItem, { backgroundColor: pressed ? c.warning + "12" : "transparent", opacity: pauseUnavailable || saving || pauseActionSaving ? 0.55 : 1 }]}
                >
                  <Feather name="edit-2" size={17} color={c.warning} />
                  <View style={styles.actionMenuCopy}>
                    <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Edit pause</Text>
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>Change the resume date or what happens to this payment</Text>
                  </View>
                </Pressable>
              ) : null}
              {onDelete ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${noun}`}
                  onPress={() => { setActionMenuVisible(false); handleDelete(); }}
                  style={({ pressed }) => [styles.actionMenuItem, { backgroundColor: pressed ? c.destructive + "12" : "transparent" }]}
                >
                  <Feather name="trash-2" size={17} color={c.destructive} />
                  <View style={styles.actionMenuCopy}>
                    <Text style={[styles.actionMenuLabel, { color: c.destructive }]}>Delete {noun}</Text>
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>Remove this {noun.toLowerCase()} and its schedule</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {historyOnly && editBill ? <ScrollView showsVerticalScrollIndicator={isDesktop}>
            <View style={[styles.transferCard, { backgroundColor: c.primary + "08", borderColor: c.primary + "25", marginTop: 0, marginBottom: 14 }]}>
              <Text style={[styles.actionMenuLabel, { color: c.primary }]}>{convertedPlan ? "Changed to transfer" : plannedTransfersError ? "Couldn’t load bill details" : "Loading bill details…"}</Text>
              <Text style={[styles.actionMenuHelp, { color: c.foreground }]}>{editBill.name}</Text>
              <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>{convertedPlan
                ? "Your earlier bill payments stay here. Manage the future schedule under Transfers between accounts."
                : plannedTransfersError ? "We couldn’t check this bill’s current status. Try again before editing it." : "Your saved payment history is available below."}</Text>
              {!convertedPlan && plannedTransfersError ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading bill details" onPress={retryBudgetLoad} style={[styles.transferAction, { borderColor: c.primary + "55" }]}>
                <Text style={[styles.entryChoiceText, { color: c.primary }]}>Retry</Text>
              </Pressable> : null}
            </View>
            <BillPaymentHistoryPanel billId={editBill.id} billName={editBill.name} />
          </ScrollView> : historyVisible && editBill ? <BillPaymentHistoryPanel billId={editBill.id} billName={editBill.name} /> : <ScrollView showsVerticalScrollIndicator={isDesktop} keyboardShouldPersistTaps="handled">

            {editBill?.is_debt ? (
              <View
                style={[
                  styles.pauseStatus,
                  { backgroundColor: c.warning + "10", borderColor: c.warning + "45" },
                ]}
              >
                <View style={styles.actionMenuCopy}>
                  <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>
                    {activePause
                      ? "Payments paused"
                      : upcomingPause
                        ? "Pause scheduled"
                        : "Need a payment break?"}
                  </Text>
                  <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>
                    {paymentPause
                      ? `${activePause ? "Payments resume" : `Starts ${pauseDateLabel(paymentPause.start_date)} · resumes`} ${pauseDateLabel(paymentPause.resume_date)}. Your debt stays open and keeps its payoff order.`
                      : pauseUnavailable || "Choose a temporary pause without closing this debt."}
                  </Text>
                  {paymentPause && Boolean(pauseUnavailable) ? (
                    <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>
                      {pauseUnavailable}
                    </Text>
                  ) : null}
                  {Boolean(pauseActionError) && (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.actionMenuHelp, { color: c.destructive }]}
                    >
                      {pauseActionError}
                    </Text>
                  )}
                </View>
                {paymentPause ? (
                  <View style={styles.pauseStatusActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit pause"
                      accessibilityState={{
                        disabled: saving || pauseActionSaving || Boolean(pauseUnavailable),
                      }}
                      disabled={saving || pauseActionSaving || Boolean(pauseUnavailable)}
                      onPress={openEditPaymentPause}
                      style={[
                        styles.pauseStatusAction,
                        styles.pauseStatusActionGrow,
                        {
                          borderColor: c.warning + "55",
                          opacity: saving || pauseActionSaving || pauseUnavailable ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.pauseStatusActionText, { color: c.foreground }]}>
                        Edit pause
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={activePause ? "Resume now" : "Cancel scheduled pause"}
                      accessibilityState={{
                        disabled: saving || pauseActionSaving || Boolean(pauseUnavailable),
                        busy: pauseActionSaving,
                      }}
                      disabled={saving || pauseActionSaving || Boolean(pauseUnavailable)}
                      onPress={resumePaymentPause}
                      style={[
                        styles.pauseStatusAction,
                        styles.pauseStatusActionGrow,
                        {
                          borderColor: c.warning + "55",
                          opacity: saving || pauseActionSaving || pauseUnavailable ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.pauseStatusActionText, { color: c.foreground }]}>
                        {pauseActionSaving
                          ? "Saving…"
                          : activePause
                            ? "Resume now"
                            : "Cancel scheduled pause"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pause debt payments"
                    accessibilityState={{
                      disabled: Boolean(pauseUnavailable) || saving || pauseActionSaving,
                    }}
                    disabled={Boolean(pauseUnavailable) || saving || pauseActionSaving}
                    onPress={openPaymentPause}
                    style={[
                      styles.pauseStatusAction,
                      {
                        borderColor: c.warning + "55",
                        opacity: pauseUnavailable || saving || pauseActionSaving ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.pauseStatusActionText, { color: c.foreground }]}>
                      Pause payments
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {editBill ? <Pressable accessibilityRole="button" accessibilityLabel={`Payment history for ${editBill.name}`}
              onPress={() => { Keyboard.dismiss(); setFrequencyOpen(false); setActionMenuVisible(false); setHistoryVisible(true); }}
              style={({ pressed }) => [styles.historyLink, { backgroundColor: c.primary + "12", borderColor: c.primary + "35", opacity: pressed ? 0.75 : 1 }]}>
              <Feather name="clock" size={21} color={c.primary} />
              <View style={styles.actionMenuCopy}>
                <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Payment history</Text>
                <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>See recorded payments for this {noun.toLowerCase()}</Text>
              </View>
              <Feather name="chevron-right" size={19} color={c.primary} />
            </Pressable> : null}

            {!editBill && !forceDebt && !isDebt ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Add bill or transfer" style={styles.entryChoices}>
                <View accessibilityRole="radio" accessibilityState={{ checked: true }} aria-checked style={[styles.entryChoice, { backgroundColor: c.primary + "18", borderColor: c.primary }]}>
                  <Feather name="file-text" size={18} color={c.primary} />
                  <Text style={[styles.entryChoiceText, { color: c.primary }]}>Bill</Text>
                </View>
                <Pressable accessibilityRole="radio" accessibilityLabel="Transfer" accessibilityState={{ checked: false, disabled: !canEditHousehold || !accountForecastReady || saving }} aria-checked={false}
                  disabled={!canEditHousehold || !accountForecastReady || saving} onPress={() => openTransfer(false)}
                  style={[styles.entryChoice, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Feather name="repeat" size={18} color={c.foreground} />
                  <Text style={[styles.entryChoiceText, { color: c.foreground }]}>Transfer</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Name */}
            <Text style={lbl}>{noun} Name</Text>
            <TextInput accessibilityLabel={`${noun} name`} style={inp} value={name} onChangeText={setName}
              placeholder={`e.g. ${isDebt ? "Car Loan" : "Electric Bill"}`}
              placeholderTextColor={c.mutedForeground} returnKeyType="next" />

            {/* Amount */}
            <Text style={lbl}>{isDebt ? "Required Minimum Payment ($)" : "Payment Amount ($)"}</Text>
            <TextInput sensitive style={inp} value={amount} onChangeText={setAmount}
              accessibilityLabel={isDebt ? "Required minimum payment" : "Payment amount"}
              placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <AccountForecastPicker label="Paid from" value={fundingAccountRef} onChange={setFundingAccountRef}
              includeHousehold={false} allowUnassigned disabled={saving || pauseActionSaving || !canEditHousehold} />

            {editBill ? (
              <View style={[styles.transferCard, { backgroundColor: c.primary + "08", borderColor: c.primary + "25" }]}>
                <View style={styles.transferCopy}>
                  <Text style={[styles.actionMenuLabel, { color: c.foreground }]}>Transfer between accounts</Text>
                  <Text style={[styles.actionMenuHelp, { color: c.mutedForeground }]}>
                    {conversionUnavailable || "Use this when the payment goes to another account you own."}
                  </Text>
                </View>
                {!conversionUnavailable ? <Pressable accessibilityRole="button" accessibilityLabel="Change to transfer"
                  accessibilityState={{ disabled: saving || !canEditHousehold || !accountForecastReady }} disabled={saving || !canEditHousehold || !accountForecastReady}
                  onPress={() => openTransfer(true)} style={[styles.transferAction, { borderColor: c.primary + "55" }]}>
                  <Feather name="repeat" size={16} color={c.primary} />
                  <Text style={[styles.entryChoiceText, { color: c.primary }]}>Change to transfer</Text>
                </Pressable> : null}
              </View>
            ) : null}

            {/* Frequency */}
            <Text style={lbl}>Frequency</Text>
            <BillFrequencyPicker value={frequency} onChange={setFrequency} debt={Boolean(isDebt || forceDebt)}
              open={frequencyOpen} onOpenChange={setFrequencyOpen} disabled={saving || pauseActionSaving} />

            {/* Monthly → calendar day picker; Weekly → day-of-week grid */}
            <DatePickerField
              label={frequency === "monthly" ? "Payment Date (optional)" : "First Payment Date"}
              value={nextPaymentDate}
              onChange={handlePaymentDateChange}
              placeholder={frequency === "monthly" ? "Use due day only" : "Pick the first pay date"}
              optional={frequency === "monthly"}
            />

            {frequency === "monthly" ? (
              <>
                <Text style={lbl}>Due Day of Month</Text>
                {/* Tappable button showing selected day — opens inline calendar */}
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowDayPicker(p => !p); }}
                  style={({ pressed }) => [
                    styles.dayPickerBtn,
                    { backgroundColor: c.muted, borderColor: showDayPicker ? c.primary : "transparent", opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name="calendar" size={15} color={c.primary} />
                  <Text style={[styles.dayPickerBtnText, { color: c.foreground }]}>
                    Day {dueDay || "—"}
                  </Text>
                  <Feather name={showDayPicker ? "chevron-up" : "chevron-down"} size={15} color={c.mutedForeground} />
                </Pressable>

                {showDayPicker && (
                  <View style={[styles.dayPickerPanel, { backgroundColor: c.card, borderColor: c.border }]}>
                    {/* Month nav — just for reference alignment */}
                    <View style={[styles.dayPickerMonthNav, { backgroundColor: c.muted }]}>
                      <Pressable onPress={() => shiftPickerMonth(-1)} hitSlop={10}>
                        <Feather name="chevron-left" size={16} color={c.foreground} />
                      </Pressable>
                      <Text style={[styles.dayPickerMonthLabel, { color: c.foreground }]}>
                        {MONTH_NAMES[pickerMonth]} {pickerYear}
                      </Text>
                      <Pressable onPress={() => shiftPickerMonth(1)} hitSlop={10}>
                        <Feather name="chevron-right" size={16} color={c.foreground} />
                      </Pressable>
                    </View>
                    {/* DOW headers */}
                    <View style={styles.calDowRow}>
                      {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                        <Text key={d} style={[styles.calDowLabel, { color: c.mutedForeground }]}>{d}</Text>
                      ))}
                    </View>
                    {/* Calendar grid */}
                    <View style={styles.calGrid}>
                      {[
                        ...Array(firstDOWInDayPickerMonth).fill(null),
                        ...Array.from({ length: daysInDayPickerMonth }, (_, i) => i + 1),
                      ].map((day, idx) =>
                        day === null ? (
                          <View key={`e${idx}`} style={styles.calCell} />
                        ) : (
                          <Pressable
                            key={day}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setDueDay(day.toString());
                              setShowDayPicker(false);
                            }}
                            style={({ pressed }) => [
                              styles.calCell,
                              {
                                backgroundColor: String(day) === dueDay ? c.primary : c.muted,
                                borderRadius: 8,
                                opacity: pressed ? 0.7 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.calCellText, { color: String(day) === dueDay ? c.primaryForeground : c.foreground }]}>
                              {day}
                            </Text>
                          </Pressable>
                        )
                      )}
                    </View>
                  </View>
                )}
              </>
            ) : frequency === "quarterly" || frequency === "yearly" ? (
              <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
                <Feather name="info" size={12} color={c.primary} />
                <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                  {frequency === "yearly" ? "Repeats once a year from the first payment date. The full amount is due each year." : "Repeats every 3 months from the first payment date."}
                </Text>
              </View>
            ) : frequency === "weekly" ? (
              <>
                <Text style={lbl}>Repeats Every</Text>
                <View style={styles.dowRow}>
                  {WEEKDAYS.map((label, idx) => (
                    <Pressable key={idx} onPress={() => setDayOfWeek(idx)}
                      style={[styles.dowBtn, {
                        backgroundColor: dayOfWeek === idx ? c.primary : c.muted,
                        borderRadius: 8,
                      }]}
                    >
                      <Text style={[styles.dowLabel, { color: dayOfWeek === idx ? c.primaryForeground : c.mutedForeground }]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
                  <Feather name="info" size={12} color={c.primary} />
                  <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                    Bill repeats every {WEEKDAYS[dayOfWeek]} - typically 4-5 times per month.
                  </Text>
                </View>

              </>
            ) : (
              <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
                <Feather name="info" size={12} color={c.primary} />
                <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                  Biweekly bills repeat every 14 days from the first pay date you choose above.
                </Text>
              </View>
            )}

            {/* Optional date range */}
            <DatePickerField
              label="Start Date (optional)"
              value={billStartDate}
              onChange={setBillStartDate}
              placeholder="No start date"
              optional
            />
            <DatePickerField
              label="End Date (optional)"
              value={billEndDate}
              onChange={setBillEndDate}
              placeholder="No end date (indefinite)"
              optional
              minDate={billStartDate || undefined}
            />

            {Boolean(billStartDate.trim() || billEndDate.trim()) && (
              <View style={[styles.infoBox, { backgroundColor: c.success + "12" }]}>
                <Feather name="calendar" size={12} color={c.success} />
                <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                  Bill only generates between{" "}
                  {billStartDate || "any date"} → {billEndDate || "indefinitely"}.
                </Text>
              </View>
            )}

            {/* Debt toggle (hidden when forceDebt) */}
            {!forceDebt && (
              <View style={[styles.toggleCard, { backgroundColor: c.card }]}>
                <View>
                  <Text style={[styles.toggleLabel, { color: c.foreground }]}>This is a Debt</Text>
                  <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Tracks balance, interest &amp; payoff</Text>
                </View>
                <Switch value={isDebt} onValueChange={value => {
                  if (value && frequency === "yearly") {
                    privacyAlerts.formError("Choose a debt payment frequency", "Choose another frequency before changing this yearly bill to debt.");
                    return;
                  }
                  setIsDebt(value);
                }}
                  trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
              </View>
            )}

            {/* Debt-specific fields */}
            {isDebt ? (
              <>
                <Text style={lbl}>Current Balance ($)</Text>
                <TextInput sensitive style={inp} value={balance} onChangeText={setBalance}
                  placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
                <Text style={lbl}>Interest Rate (% APR)</Text>
                <TextInput style={inp} value={interestRate} onChangeText={setInterestRate}
                  placeholder="0.0" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
                {settings.debtPayoffEnabled && <View style={[styles.toggleCard, { backgroundColor: c.card }]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.payoffLabelRow}>
                      <Text style={[styles.toggleLabel, { color: c.foreground }]}>Include in payoff plan</Text>
                      <Pressable
                        hitSlop={10}
                        accessibilityLabel="Explain the Snowball payoff plan"
                        onPress={() => privacyAlerts.alert(
                          "How payoff plans work",
                          "Snowball sends extra money to the smallest balance first for quicker wins. Minimum payments stay protected.",
                        )}
                      >
                        <Feather name="info" size={16} color={c.primary} />
                      </Pressable>
                    </View>
                    <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Send extra payments to this debt</Text>
                  </View>
                  <Switch value={includeInSnowball} onValueChange={setIncludeInSnowball}
                    trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
                </View>}
                {settings.debtPayoffEnabled && <View style={[styles.infoBox, { backgroundColor: c.primary + "15" }]}>
                  <Feather name="info" size={13} color={c.primary} />
                  <Text style={[styles.infoText, { color: c.primary }]}>
                    Snowball priority: smallest debt balance = #1.
                  </Text>
                </View>}
              </>
            ) : (
              <>
                <Text style={lbl}>Category</Text>
                <View style={styles.categoryGrid}>
                  {nonDebtCategories.map(cat => (
                    <Pressable key={cat} onPress={() => setCategory(cat)}
                      style={[styles.chip, { backgroundColor: category === cat ? c.primary : c.muted, borderRadius: 8 }]}
                    >
                      <Text style={[styles.chipText, { color: category === cat ? c.primaryForeground : c.mutedForeground }]}>
                        {cat}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {isDebt ? (
              <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
                <Feather name="shield" size={13} color={c.primary} />
                <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                  Debt minimums are always Must Pay, so Flo protects them before flexible or optional bills.
                </Text>
              </View>
            ) : (
              <>
                <Text style={lbl}>How important is this bill?</Text>
                <View style={styles.priorityGrid}>
                  {BILL_IMPORTANCE_OPTIONS.map(option => {
                    const selected = smartPriority === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={`${option.label}. ${option.description}`}
                        onPress={() => setSmartPriority(option.value)}
                        style={({ pressed }) => [
                          styles.priorityOption,
                          {
                            borderColor: selected ? c.primary : c.border,
                            backgroundColor: selected ? c.primary + "14" : c.card,
                            opacity: pressed ? 0.75 : 1,
                          },
                        ]}
                      >
                        <View style={styles.priorityOptionTop}>
                          <Feather name={option.icon} size={14} color={selected ? c.primary : c.mutedForeground} />
                          <Text style={[styles.priorityLabel, { color: selected ? c.primary : c.foreground }]}>{option.label}</Text>
                        </View>
                        <Text style={[styles.priorityDescription, { color: c.mutedForeground }]}>{option.description}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Recurring toggle — hidden for debt (debts are always recurring) */}
            {!isDebt && !forceDebt && (
              <View style={[styles.toggleCard, { backgroundColor: c.card, marginTop: 14 }]}>
                <View>
                  <Text style={[styles.toggleLabel, { color: c.foreground }]}>Recurring</Text>
                  <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Appears automatically each month</Text>
                </View>
                <Switch value={isRecurring} onValueChange={setIsRecurring}
                  trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
              </View>
            )}

            {/* Save */}
            <Pressable accessibilityRole="button" accessibilityLabel={saveLabel ?? (editBill ? `Update ${noun}` : `Add ${noun}`)} disabled={saving || pauseActionSaving || !canEditHousehold} onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: saving || pauseActionSaving ? 0.55 : pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {saving ? "Saving…" : saveLabel ?? (editBill ? `Update ${noun}` : `Add ${noun}`)}
              </Text>
            </Pressable>

          </ScrollView>}
        </View>
      </KeyboardAvoidingView>
      <ConfirmActionOverlay request={confirmation} onClose={() => setConfirmation(null)} />
      {currentDebt && <DebtPaymentPauseModal
        visible={visible && pauseVisible}
        bill={currentDebt}
        editingPause={editingPaymentPause}
        today={today}
        canEdit={canEditHousehold}
        redirectEnabled={settings.debtPayoffEnabled}
        openDateField={pauseDateField}
        step={pauseStep}
        onStepChange={setPauseStep}
        onOpenDateFieldChange={setPauseDateField}
        onSavingChange={pending => { pausePendingRef.current = pending; }}
        onClose={() => { setPauseVisible(false); setEditingPaymentPause(undefined); setPauseDateField(null); setPauseStep("dates"); }}
        onSave={savePaymentPause}
      />}
    </Modal>
    <PlannedTransferModal
      visible={visible && Boolean(transferFlow) && transferFlow?.scope === transferScopeKey}
      initialValues={transferFlow?.initialValues}
      conversionBill={transferFlow?.bill}
      onBackToBill={() => setTransferFlow(null)}
      onClose={() => setTransferFlow(null)}
      onSaved={() => { setTransferFlow(null); onClose(); }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  entryChoices: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 4 },
  entryChoice: { flex: 1, minWidth: 0, minHeight: 46, borderWidth: 1, borderRadius: 12, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, padding: 10 },
  entryChoiceText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  transferCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 10, marginTop: 12 },
  transferCopy: { gap: 2 },
  transferAction: { alignSelf: "flex-start", minHeight: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "94%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  historyBack: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  historyLink: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 4 },
  headerActionButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  actionMenu: { borderWidth: 1, borderRadius: 14, paddingVertical: 4, marginBottom: 10 },
  actionMenuItem: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 10 },
  actionMenuCopy: { flex: 1, minWidth: 0 },
  pauseStatus: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  pauseStatusActions: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pauseStatusActionGrow: { flex: 1, minWidth: 0 },
  pauseStatusAction: { minHeight: 42, justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  pauseStatusActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionMenuLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actionMenuHelp: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  dowRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dowBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  dowLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 10, borderRadius: 8, marginTop: 8 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  toggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, marginTop: 14 },
  payoffLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  priorityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  priorityOption: { width: "100%", borderRadius: 12, borderWidth: 1, padding: 10, minHeight: 68 },
  priorityOptionTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  priorityLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  priorityDescription: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  dayPickerBtn: { flexDirection: "row", alignItems: "center", gap: 10, height: 48, borderRadius: 10, paddingHorizontal: 14, borderWidth: 1.5 },
  dayPickerBtnText: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dayPickerPanel: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  dayPickerMonthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10 },
  dayPickerMonthLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  calDowRow: { flexDirection: "row", marginBottom: 4 },
  calDowLabel: { width: "14.285714%", textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: "14.285714%", height: 38, alignItems: "center", justifyContent: "center" },
  calCellText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteMistakeBtn: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 58, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: -20, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  deleteHelpText: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2, lineHeight: 15 },
});

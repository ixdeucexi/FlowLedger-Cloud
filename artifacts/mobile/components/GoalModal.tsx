import { SPENDING_BUCKETS_ROUTE } from "@/lib/settingsNavigation";
import { showFormError } from "@/lib/formInputAlert";
import { parseMoneyInput } from "@/lib/moneyFormInput";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "@/lib/haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import { FloSafetyStopModal } from "@/components/FloSafetyStopModal";
import { buildBucketSafetyStop, type SafetyStopWarning } from "@/lib/safetyStop";
import { ConfirmActionOverlay } from "@/components/ConfirmActionModal";
import { DatePickerField } from "@/components/DatePickerField";
import { useBudget, type Goal } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { DESKTOP_MODAL_COMPACT, DESKTOP_MODAL_HANDLE, DESKTOP_MODAL_OVERLAY } from "@/lib/desktopModal";
import type { ConfirmActionOptions } from "@/lib/confirmAction";

function pad(n: number) { return String(n).padStart(2, "0"); }

function dateToYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (goal: Omit<Goal, "id" | "created_at"> | Goal) => void | Promise<unknown>;
  onDelete?: (id: string) => void | Promise<unknown>;
  editGoal?: Goal | null;
  initialMode?: "savings" | "budget";
  initialName?: string;
  initialTargetAmount?: number;
  initialTargetDate?: string;
  title?: string;
  saveLabel?: string;
  lockedMode?: "savings" | "budget";
  minimumTargetAmount?: number;
  minimumTargetDate?: string;
  hint?: string;
  skipAffordabilityCheck?: boolean;
  hideBucketLifecycle?: boolean;
}

export function GoalModal({
  visible, onClose, onSave, onDelete, editGoal, initialMode = "savings", initialName = "", initialTargetAmount,
  initialTargetDate, title, saveLabel, lockedMode, minimumTargetAmount, minimumTargetDate, hint, skipAffordabilityCheck = false, hideBucketLifecycle = false,
}: Props) {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const { getDailyBalances, settings, goals, canEditHousehold, activeHousehold, previewBucketBudgetSafetyStop } = useBudget();
  const router = useRouter();
  const { user } = useAuth();
  const closeNavigationRef = useRef(false);
  const currentBucket = editGoal ? goals.find(goal => goal.id === editGoal.id && goal.goal_type === "planned_expense") : undefined;
  const canCloseBucket = canEditHousehold && currentBucket && !currentBucket.closed_at && !currentBucket.archived_at;
  const openCloseBucket = () => {
    if (!canCloseBucket || savingRef.current || closeNavigationRef.current) return;
    closeNavigationRef.current = true;
    onClose();
    router.push({ pathname: "/(tabs)/more", params: {
      ...SPENDING_BUCKETS_ROUTE.params, closeBucketId: currentBucket.id,
      closeBucketScope: `${user?.id ?? "demo"}:${activeHousehold?.householdId ?? "personal"}`,
      closeBucketAt: String(Date.now()),
    } });
  };

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [goalMode, setGoalMode] = useState<"savings" | "budget">("savings");
  const [targetDate, setTargetDate] = useState(""); // YYYY-MM-DD
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmActionOptions | null>(null);
  const savingRef = useRef(false);
  const [pendingGoal, setPendingGoal] = useState<Omit<Goal, "id" | "created_at"> | null>(null);
  const [safetyStop, setSafetyStop] = useState<SafetyStopWarning | null>(null);
  const keepEditing = () => {
    if (savingRef.current) return;
    setPendingGoal(null);
    setSafetyStop(null);
  };
  const requestClose = () => {
    if (savingRef.current) return;
    if (safetyStop) keepEditing();
    else onClose();
  };
  useBackDismiss(visible, requestClose, true, Boolean(safetyStop));

  const today = new Date();
  const todayYMD = dateToYMD(today);

  useEffect(() => {
    closeNavigationRef.current = false;
    setSaveError(null);
    setConfirmation(null);
    setPendingGoal(null);
    setSafetyStop(null);
    if (editGoal) {
      setName(editGoal.name);
      setTarget(editGoal.target_amount.toString());
      setCurrent(editGoal.current_amount > 0 ? editGoal.current_amount.toString() : "");
      setGoalMode(editGoal.goal_type === "planned_expense" ? "budget" : "savings");
      setTargetDate(editGoal.target_date.split("T")[0]);
    } else {
      setName(initialName);
      setTarget(initialTargetAmount !== undefined ? initialTargetAmount.toFixed(2) : "");
      setCurrent("");
      setGoalMode(lockedMode ?? initialMode);
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      setTargetDate(initialTargetDate || dateToYMD(d));
    }
  }, [editGoal, initialMode, initialName, initialTargetAmount, initialTargetDate, lockedMode, visible]);

  const saveGoal = async (payload: Omit<Goal, "id" | "created_at"> | Goal) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(editGoal ? { ...payload, id: editGoal.id, created_at: editGoal.created_at } : payload);
      setPendingGoal(null);
      setSafetyStop(null);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn’t save. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (savingRef.current || pendingGoal) return;
    const t = parseMoneyInput(target);
    const savedAmount = current.trim() ? parseMoneyInput(current) : 0;
    if (t === null || t <= 0 || (goalMode === "savings" && savedAmount === null)) { showFormError("Check amounts", "Enter a positive target and a nonnegative saved amount with up to two decimal places."); return; }
    if (!name.trim() || !targetDate) return;
    const minimumBucketAmount = Math.max(minimumTargetAmount ?? 0, editGoal?.goal_type === "planned_expense" ? editGoal.current_amount : 0);
    if (t + 0.005 < minimumBucketAmount) {
      showFormError("Bucket amount is too small", editGoal?.goal_type === "planned_expense"
        ? `The budget must be at least $${minimumBucketAmount.toFixed(2)} to cover purchases already recorded.`
        : `Enter at least $${minimumBucketAmount.toFixed(2)} to include this posted transaction. You can enter more for future purchases.`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Goal, "id" | "created_at"> = {
      name: name.trim(),
      target_amount: t,
      current_amount: goalMode === "budget"
        ? editGoal?.goal_type === "planned_expense" ? editGoal.current_amount : 0
        : (savedAmount ?? 0),
      target_date: targetDate, // stored as YYYY-MM-DD
      goal_type: goalMode === "budget" ? "planned_expense" : "savings",
      closed_at: goalMode === "budget" ? editGoal?.closed_at : undefined,
      closed_by: goalMode === "budget" ? editGoal?.closed_by : undefined,
    };
    if (!skipAffordabilityCheck && editGoal?.goal_type === "planned_expense" && goalMode === "budget" && typeof previewBucketBudgetSafetyStop === "function") {
      const warning = previewBucketBudgetSafetyStop({ ...editGoal, ...data });
      if (warning) { setPendingGoal(data); setSafetyStop(warning); return; }
    }
    if (!skipAffordabilityCheck && !editGoal && goalMode === "budget") {
      const warning = buildBucketSafetyStop({
        name: data.name, amount: data.target_amount, targetDate: data.target_date,
        safetyFloor: settings.safety_floor, horizonMonths: settings.forecast_horizon_months,
        getDailyBalances,
      });
      if (warning) {
        setPendingGoal(data);
        setSafetyStop(warning);
        return;
      }
    }
    await saveGoal(editGoal ? { ...data, id: editGoal.id, created_at: editGoal.created_at } : data);
  };

  const handleDelete = () => {
    if (!editGoal || !onDelete) return;
    const deletingBucket = editGoal.goal_type === "planned_expense";
    const deleteLabel = deletingBucket ? "bucket" : "goal";
    setConfirmation({
      title: `Delete ${deletingBucket ? "Bucket" : "Goal"}`,
      message: `Delete "${editGoal.name}"? This removes the ${deleteLabel} from Forecast and your plan.`,
      confirmText: `Delete ${deleteLabel}`,
      destructive: true,
      onConfirm: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await onDelete(editGoal.id);
        onClose();
      },
    });
  };

  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl   = [styles.label, { color: c.mutedForeground }];
  const itemLabel = goalMode === "budget" ? "Bucket" : "Goal";

  return (
    <>
      <Modal
        visible={visible}
        animationType={isDesktop ? "fade" : "slide"}
        transparent
        onRequestClose={() => confirmation ? setConfirmation(null) : requestClose()}
      >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.overlay, isDesktop && DESKTOP_MODAL_OVERLAY]}>
        <Pressable accessibilityLabel="Close goal editor" disabled={saving} onPress={requestClose} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.container, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_COMPACT]}>
          <View style={[styles.handle, isDesktop && DESKTOP_MODAL_HANDLE]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {title ?? (editGoal ? "Edit Goal or Bucket" : "Set Aside Money")}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={lockedMode === "budget" || editGoal?.goal_type === "planned_expense" || goalMode === "budget" ? "Close bucket editor" : "Close savings goal editor"} disabled={saving} onPress={requestClose} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={isDesktop}>

            {/* ── Goal type ── */}
            {!lockedMode ? <>
              <Text style={lbl}>Goal Type</Text>
              <View style={styles.modeRow}>
              {([
                { id: "savings" as const, label: "Savings Goal", icon: "trending-up" as const },
                { id: "budget" as const, label: "Spending Bucket", icon: "calendar" as const },
              ]).map(option => {
                const selected = goalMode === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setGoalMode(option.id)}
                    style={[styles.modeBtn, { backgroundColor: selected ? c.primary + "18" : c.muted, borderColor: selected ? c.primary : c.border }]}
                  >
                    <Feather name={option.icon} size={16} color={selected ? c.primary : c.mutedForeground} />
                    <Text style={[styles.modeText, { color: selected ? c.primary : c.foreground }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
              </View>
              <Text style={[styles.modeHint, { color: c.mutedForeground }]}>
                {goalMode === "budget"
                  ? "Set aside money for something you expect to buy. Match the bank charge to this bucket when it posts."
                  : "Track money you are actively setting aside toward a target."}
              </Text>
            </> : null}

            {/* ── Name ── */}
            <Text style={lbl}>{goalMode === "budget" ? "What are you planning?" : "Goal Name"}</Text>
            <TextInput
              style={input}
              value={name}
              onChangeText={setName}
              placeholder={goalMode === "budget" ? "e.g. Christmas gifts" : "e.g. Emergency fund"}
              placeholderTextColor={c.mutedForeground}
            />

            {/* ── Target amount ── */}
            <Text style={lbl}>Target Amount ($)</Text>
            <TextInput
              style={input}
              value={target}
              onChangeText={setTarget}
              placeholder="2000.00"
              placeholderTextColor={c.mutedForeground}
              keyboardType="decimal-pad"
            />

            {goalMode === "savings" && (
              <>
                {/* ── Already saved ── */}
                <Text style={lbl}>Already Saved ($)</Text>
                <TextInput
                  style={input}
                  value={current}
                  onChangeText={setCurrent}
                  placeholder="0.00"
                  placeholderTextColor={c.mutedForeground}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            {/* ── Target date ── */}
            <DatePickerField
              label="Target Date"
              value={targetDate}
              onChange={setTargetDate}
              placeholder="Pick a date…"
              minDate={minimumTargetDate ?? todayYMD}
            />

            {/* ── Info hint ── */}
            <View style={[styles.hint, { backgroundColor: c.primary + "15", borderRadius: 8 }]}>
              <Feather name="info" size={13} color={c.primary} />
              <Text style={[styles.hintText, { color: c.mutedForeground }]}>
                {hint ?? (goalMode === "budget"
                  ? "This amount is protected in your calendar until you match the real bank transaction. It will only count once."
                  : "Add contributions over time and compare your saved amount with the target.")}
              </Text>
            </View>

            {/* ── Save ── */}
            {saveError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: c.destructive, fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 19, marginTop: 14 }}>{saveError}</Text> : null}
            <Pressable
              disabled={saving}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, borderRadius: colors.radius, opacity: saving ? 0.55 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {saving ? "Saving…" : saveLabel ?? `${editGoal ? "Update" : "Create"} ${itemLabel}`}
              </Text>
            </Pressable>

            {canCloseBucket && !hideBucketLifecycle ? <>
              <Pressable accessibilityRole="button" accessibilityLabel={`Close ${currentBucket.name} bucket`} disabled={saving} onPress={openCloseBucket} style={[styles.deleteBtn, { borderColor: c.primary, opacity: saving ? 0.5 : 1 }]}>
                <Feather name="check-circle" size={16} color={c.primary} />
                <Text style={[styles.deleteBtnText, { color: c.primary }]}>Close bucket</Text>
              </Pressable>
              <Text style={[styles.modeHint, { color: c.mutedForeground }]}>Review the saved bucket and choose what happens to any money left. Posted spending stays in your history.</Text>
            </> : null}

            {editGoal && onDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete {itemLabel}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <ConfirmActionOverlay request={confirmation} onClose={() => setConfirmation(null)} />
      </Modal>
      <FloSafetyStopModal
        visible={visible && Boolean(safetyStop)}
        warning={safetyStop}
        manageBackHistory={false}
        onKeepEditing={keepEditing}
        onScheduleAnyway={pendingGoal ? () => { void saveGoal(pendingGoal); } : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "92%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  modeRow: { flexDirection: "row", gap: 8 },
  modeBtn: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  modeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modeHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 7 },
  hint: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, marginTop: 14 },
  hintText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 20 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

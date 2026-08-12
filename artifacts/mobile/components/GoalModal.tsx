import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import { BucketAffordabilityModal } from "@/components/BucketAffordabilityModal";
import { ConfirmActionOverlay } from "@/components/ConfirmActionModal";
import { DatePickerField } from "@/components/DatePickerField";
import { useBudget, type Goal, type GoalAffordability } from "@/context/BudgetContext";
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
}

export function GoalModal({ visible, onClose, onSave, onDelete, editGoal, initialMode = "savings", initialName = "", initialTargetAmount, initialTargetDate }: Props) {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const { checkGoalAffordability, settings } = useBudget();
  useBackDismiss(visible, onClose);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [goalMode, setGoalMode] = useState<"savings" | "budget">("savings");
  const [targetDate, setTargetDate] = useState(""); // YYYY-MM-DD
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmActionOptions | null>(null);
  const [bucketCheck, setBucketCheck] = useState<{
    name: string;
    amount: number;
    targetDate: string;
    result: GoalAffordability;
  } | null>(null);

  const today = new Date();
  const todayYMD = dateToYMD(today);

  useEffect(() => {
    setConfirmation(null);
    if (editGoal) {
      setName(editGoal.name);
      setTarget(editGoal.target_amount.toString());
      setCurrent(editGoal.current_amount > 0 ? editGoal.current_amount.toString() : "");
      setGoalMode(editGoal.goal_type === "planned_expense" ? "budget" : "savings");
      setTargetDate(editGoal.target_date.split("T")[0]);
    } else {
      setName(initialName);
      setTarget(initialTargetAmount ? initialTargetAmount.toFixed(2) : "");
      setCurrent("");
      setGoalMode(initialMode);
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      setTargetDate(initialTargetDate || dateToYMD(d));
    }
  }, [editGoal, initialMode, initialName, initialTargetAmount, initialTargetDate, visible]);

  const handleSave = async () => {
    if (saving) return;
    const t = parseFloat(target);
    if (!name.trim() || isNaN(t) || t <= 0 || !targetDate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Goal, "id" | "created_at"> = {
      name: name.trim(),
      target_amount: t,
      current_amount: goalMode === "budget"
        ? editGoal?.goal_type === "planned_expense" ? editGoal.current_amount : 0
        : (parseFloat(current) || 0),
      target_date: targetDate, // stored as YYYY-MM-DD
      goal_type: goalMode === "budget" ? "planned_expense" : "savings",
      closed_at: goalMode === "budget" ? editGoal?.closed_at : undefined,
      closed_by: goalMode === "budget" ? editGoal?.closed_by : undefined,
    };
    const targetParts = targetDate.split("-").map(Number);
    const affordability = !editGoal && goalMode === "budget" && targetParts.length === 3
      ? checkGoalAffordability(
          {
            ...data,
            id: "bucket-affordability-preview",
            created_at: new Date().toISOString(),
          },
          targetParts[1] - 1,
          targetParts[0],
        )
      : null;
    setSaving(true);
    try {
      if (editGoal) await onSave({ ...data, id: editGoal.id, created_at: editGoal.created_at });
      else await onSave(data);
      onClose();
      if (affordability) {
        setTimeout(() => setBucketCheck({
          name: data.name,
          amount: data.target_amount,
          targetDate: data.target_date,
          result: affordability,
        }), 360);
      }
    } catch (error) {
      Alert.alert("Couldn’t save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
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
        onRequestClose={() => confirmation ? setConfirmation(null) : onClose()}
      >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.overlay, isDesktop && DESKTOP_MODAL_OVERLAY]}>
        <Pressable accessibilityLabel="Close goal editor" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.container, { backgroundColor: c.background }, isDesktop && DESKTOP_MODAL_COMPACT]}>
          <View style={[styles.handle, isDesktop && DESKTOP_MODAL_HANDLE]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {editGoal ? "Edit Goal or Bucket" : "Set Aside Money"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={isDesktop}>

            {/* ── Goal type ── */}
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
              minDate={todayYMD}
            />

            {/* ── Info hint ── */}
            <View style={[styles.hint, { backgroundColor: c.primary + "15", borderRadius: 8 }]}>
              <Feather name="info" size={13} color={c.primary} />
              <Text style={[styles.hintText, { color: c.mutedForeground }]}>
                {goalMode === "budget"
                  ? "This amount is protected in your calendar until you match the real bank transaction. It will only count once."
                  : "Add contributions over time and compare your saved amount with the target."}
              </Text>
            </View>

            {/* ── Save ── */}
            <Pressable
              disabled={saving}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, borderRadius: colors.radius, opacity: saving ? 0.55 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {saving ? "Saving…" : `${editGoal ? "Update" : "Create"} ${itemLabel}`}
              </Text>
            </Pressable>

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
      <BucketAffordabilityModal
        visible={Boolean(bucketCheck)}
        bucketName={bucketCheck?.name ?? ""}
        amount={bucketCheck?.amount ?? 0}
        targetDate={bucketCheck?.targetDate ?? ""}
        safetyFloor={settings.safety_floor}
        result={bucketCheck?.result ?? null}
        onClose={() => setBucketCheck(null)}
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

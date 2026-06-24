import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import type { Goal } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";

function pad(n: number) { return String(n).padStart(2, "0"); }

function dateToYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (goal: Omit<Goal, "id" | "created_at"> | Goal) => void;
  onDelete?: (id: string) => void;
  editGoal?: Goal | null;
}

export function GoalModal({ visible, onClose, onSave, onDelete, editGoal }: Props) {
  const c = useColors();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [goalMode, setGoalMode] = useState<"savings" | "budget">("savings");
  const [targetDate, setTargetDate] = useState(""); // YYYY-MM-DD

  const today = new Date();
  const todayYMD = dateToYMD(today);

  useEffect(() => {
    if (editGoal) {
      setName(editGoal.name);
      setTarget(editGoal.target_amount.toString());
      setCurrent(editGoal.current_amount > 0 ? editGoal.current_amount.toString() : "");
      setGoalMode(editGoal.goal_type === "planned_expense" ? "budget" : "savings");
      setTargetDate(editGoal.target_date.split("T")[0]);
    } else {
      setName(""); setTarget(""); setCurrent(""); setGoalMode("savings");
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      setTargetDate(dateToYMD(d));
    }
  }, [editGoal, visible]);

  const handleSave = () => {
    const t = parseFloat(target);
    if (!name.trim() || isNaN(t) || t <= 0 || !targetDate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Goal, "id" | "created_at"> = {
      name: name.trim(),
      target_amount: t,
      current_amount: goalMode === "budget" ? -1 : (parseFloat(current) || 0),
      target_date: targetDate, // stored as YYYY-MM-DD
      goal_type: goalMode === "budget" ? "planned_expense" : "savings",
    };
    if (editGoal) onSave({ ...data, id: editGoal.id, created_at: editGoal.created_at });
    else onSave(data);
    onClose();
  };

  const handleDelete = () => {
    if (!editGoal || !onDelete) return;
    const doDelete = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onDelete(editGoal.id);
      onClose();
    };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Delete Goal", `Remove "${editGoal.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl   = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {editGoal ? "Edit Goal" : "New Financial Goal"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* ── Goal type ── */}
            <Text style={lbl}>Goal Type</Text>
            <View style={styles.modeRow}>
              {([
                { id: "savings" as const, label: "Savings Goal", icon: "trending-up" as const },
                { id: "budget" as const, label: "Can I Afford It?", icon: "calendar" as const },
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
                ? "See whether your projected account balance can cover the full amount on that date."
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
                  ? "This checks your projected account balance on the selected date. Nothing is treated as already saved."
                  : "Add contributions over time and compare your saved amount with the target."}
              </Text>
            </View>

            {/* ── Save ── */}
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {editGoal ? "Update Goal" : "Create Goal"}
              </Text>
            </Pressable>

            {editGoal && onDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete Goal</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import type { Goal } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (goal: Omit<Goal, "id" | "created_at"> | Goal) => void;
  onDelete?: (id: string) => void;
  editGoal?: Goal | null;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function dateToYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDisplay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export function GoalModal({ visible, onClose, onSave, onDelete, editGoal }: Props) {
  const c = useColors();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [targetDate, setTargetDate] = useState(""); // YYYY-MM-DD

  const [calOpen, setCalOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(0);
  const [pickerYear, setPickerYear] = useState(0);

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth(); // 0-indexed

  // Initialise state when modal opens or editGoal changes
  useEffect(() => {
    let initDate: string;
    if (editGoal) {
      setName(editGoal.name);
      setTarget(editGoal.target_amount.toString());
      setCurrent(editGoal.current_amount > 0 ? editGoal.current_amount.toString() : "");
      initDate = editGoal.target_date.split("T")[0];
    } else {
      setName(""); setTarget(""); setCurrent("");
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      initDate = dateToYMD(d);
    }
    setTargetDate(initDate);
    setCalOpen(false);
    const [y, m] = initDate.split("-").map(Number);
    setPickerYear(y);
    setPickerMonth(m - 1);
  }, [editGoal, visible]);

  const daysInPickerMonth = new Date(pickerYear, pickerMonth + 1, 0).getDate();
  const selectedDay = targetDate
    ? (() => { const [y, m, d] = targetDate.split("-").map(Number); return (y === pickerYear && m - 1 === pickerMonth) ? d : null; })()
    : null;

  const atMinMonth = pickerYear === todayY && pickerMonth <= todayM;

  const shiftMonth = (delta: number) => {
    let m = pickerMonth + delta;
    let y = pickerYear;
    if (m > 11) { m = 0; y += 1; }
    if (m < 0)  { m = 11; y -= 1; }
    // Don't go before current month
    if (y < todayY || (y === todayY && m < todayM)) return;
    setPickerMonth(m);
    setPickerYear(y);
  };

  const pickDay = (day: number) => {
    // Clamp to valid days in case month has fewer days
    const maxDay = new Date(pickerYear, pickerMonth + 1, 0).getDate();
    const safeDay = Math.min(day, maxDay);
    const newDate = `${pickerYear}-${pad(pickerMonth + 1)}-${pad(safeDay)}`;
    setTargetDate(newDate);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCalOpen(false);
  };

  const handleSave = () => {
    const t = parseFloat(target);
    if (!name.trim() || isNaN(t) || t <= 0 || !targetDate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Goal, "id" | "created_at"> = {
      name: name.trim(),
      target_amount: t,
      current_amount: parseFloat(current) || 0,
      target_date: targetDate, // stored as YYYY-MM-DD
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

            {/* ── Name ── */}
            <Text style={lbl}>Goal Name</Text>
            <TextInput
              style={input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Christmas Fund"
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

            {/* ── Target date ── */}
            <Text style={lbl}>Target Date</Text>

            {/* Trigger button */}
            <Pressable
              onPress={() => setCalOpen(o => !o)}
              style={({ pressed }) => [
                styles.dateBtn,
                {
                  backgroundColor: c.muted,
                  borderColor: calOpen ? c.primary : "transparent",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="calendar" size={16} color={calOpen ? c.primary : c.mutedForeground} />
              <Text style={[styles.dateBtnText, { color: targetDate ? c.foreground : c.mutedForeground }]}>
                {targetDate ? formatDisplay(targetDate) : "Pick a date…"}
              </Text>
              <Feather name={calOpen ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
            </Pressable>

            {/* Inline calendar */}
            {calOpen && (
              <View style={[styles.calendarBox, { backgroundColor: c.card, borderRadius: colors.radius }]}>

                {/* Month / year navigation */}
                <View style={styles.monthNav}>
                  <Pressable
                    onPress={() => shiftMonth(-1)}
                    hitSlop={10}
                    style={[styles.navArrow, { opacity: atMinMonth ? 0.3 : 1 }]}
                    disabled={atMinMonth}
                  >
                    <Feather name="chevron-left" size={20} color={c.foreground} />
                  </Pressable>
                  <Text style={[styles.monthLabel, { color: c.foreground }]}>
                    {MONTH_NAMES[pickerMonth]} {pickerYear}
                  </Text>
                  <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={styles.navArrow}>
                    <Feather name="chevron-right" size={20} color={c.foreground} />
                  </Pressable>
                </View>

                {/* Day grid */}
                <View style={styles.dayGrid}>
                  {Array.from({ length: daysInPickerMonth }, (_, i) => i + 1).map(day => {
                    const isSel = day === selectedDay;
                    // Grey out past days in current month
                    const isPast = pickerYear === todayY
                      && pickerMonth === todayM
                      && day < today.getDate();
                    return (
                      <Pressable
                        key={day}
                        onPress={() => !isPast && pickDay(day)}
                        style={({ pressed }) => [
                          styles.dayBtn,
                          {
                            backgroundColor: isSel
                              ? c.primary
                              : c.muted,
                            opacity: isPast ? 0.28 : pressed ? 0.7 : 1,
                            borderRadius: 8,
                          },
                        ]}
                      >
                        <Text style={[styles.dayBtnText, { color: isSel ? c.primaryForeground : c.foreground }]}>
                          {day}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {targetDate && (
                  <Text style={[styles.selectedLabel, { color: c.mutedForeground }]}>
                    Selected: {formatDisplay(targetDate)}
                  </Text>
                )}
              </View>
            )}

            {/* ── Info hint ── */}
            <View style={[styles.hint, { backgroundColor: c.primary + "15", borderRadius: 8 }]}>
              <Feather name="info" size={13} color={c.primary} />
              <Text style={[styles.hintText, { color: c.mutedForeground }]}>
                The app will check if your projected balance (income − bills) covers this goal amount by the target date.
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
  dateBtn: {
    height: 48, borderRadius: 10, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5,
  },
  dateBtnText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  calendarBox: { marginTop: 8, padding: 12, marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navArrow: { padding: 4 },
  monthLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  dayBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  dayBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  selectedLabel: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2, marginBottom: 4 },
  hint: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, marginTop: 14 },
  hintText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 20 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

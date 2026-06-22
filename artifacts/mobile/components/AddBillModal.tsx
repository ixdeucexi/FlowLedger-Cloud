import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface AddBillModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (bill: Omit<Bill, "id" | "created_at"> | Bill) => void;
  onDelete?: (id: string) => void;
  editBill?: Bill | null;
  forceDebt?: boolean;
}

export function AddBillModal({ visible, onClose, onSave, onDelete, editBill, forceDebt }: AddBillModalProps) {
  const c = useColors();
  const { categories } = useBudget();

  const [name,          setName]          = useState("");
  const [amount,        setAmount]        = useState("");
  const [category,      setCategory]      = useState("Other");
  const [isDebt,        setIsDebt]        = useState(false);
  const [balance,       setBalance]       = useState("");
  const [interestRate,  setInterestRate]  = useState("");
  const [includeInSnowball, setIncludeInSnowball] = useState(true);
  const [dueDay,        setDueDay]        = useState("1");
  const [dayOfWeek,     setDayOfWeek]     = useState(0);      // 0=Sun … 6=Sat
  const [isRecurring,   setIsRecurring]   = useState(true);
  const [frequency,     setFrequency]     = useState<Bill["frequency"]>("monthly");
  const [billStartDate, setBillStartDate] = useState("");     // YYYY-MM-DD
  const [billEndDate,   setBillEndDate]   = useState("");     // YYYY-MM-DD
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [pickerYear,    setPickerYear]    = useState(() => new Date().getFullYear());
  const [pickerMonth,   setPickerMonth]   = useState(() => new Date().getMonth());

  const firstDOWInDayPickerMonth = useMemo(
    () => new Date(pickerYear, pickerMonth, 1).getDay(),
    [pickerYear, pickerMonth]
  );
  const daysInDayPickerMonth = useMemo(
    () => new Date(pickerYear, pickerMonth + 1, 0).getDate(),
    [pickerYear, pickerMonth]
  );
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const shiftPickerMonth = (dir: number) => {
    setPickerMonth(m => {
      const next = m + dir;
      if (next < 0) { setPickerYear(y => y - 1); return 11; }
      if (next > 11) { setPickerYear(y => y + 1); return 0; }
      return next;
    });
  };

  useEffect(() => {
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.is_debt ? "Other" : editBill.category);
      setIsDebt(editBill.is_debt);
      setBalance(editBill.balance > 0 ? editBill.balance.toString() : "");
      setInterestRate(editBill.interest_rate > 0 ? editBill.interest_rate.toString() : "");
      setIncludeInSnowball(editBill.include_in_snowball !== false);
      setDueDay(editBill.due_day.toString());
      setDayOfWeek(editBill.day_of_week ?? 0);
      setIsRecurring(editBill.is_recurring);
      setFrequency(editBill.frequency ?? "monthly");
      setBillStartDate(editBill.start_date ?? "");
      setBillEndDate(editBill.end_date ?? "");
    } else {
      setName(""); setAmount(""); setCategory("Other");
      setIsDebt(forceDebt ?? false); setBalance(""); setInterestRate(""); setIncludeInSnowball(true);
      setDueDay("1"); setDayOfWeek(0); setIsRecurring(true);
      setFrequency("monthly"); setBillStartDate(""); setBillEndDate("");
    }
  }, [editBill, visible, forceDebt]);

  const noun = forceDebt || isDebt ? "Debt" : "Bill";

  const handleSave = () => {
    const parsedAmount = parseFloat(amount);
    if (!name.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Bill, "id" | "created_at"> = {
      name: name.trim(),
      amount: parsedAmount,
      category: isDebt ? "Debt" : category,
      priority: isDebt ? 0 : 99,
      is_debt: isDebt,
      balance: isDebt ? (parseFloat(balance) || 0) : 0,
      interest_rate: isDebt ? (parseFloat(interestRate) || 0) : 0,
      due_day: parseInt(dueDay) || 1,
      day_of_week: dayOfWeek,
      start_date: billStartDate.trim() || undefined,
      end_date: billEndDate.trim() || undefined,
      is_recurring: isDebt ? true : isRecurring,
      frequency,
      include_in_snowball: isDebt ? includeInSnowball : false,
    };
    if (editBill) onSave({ ...data, id: editBill.id, created_at: editBill.created_at });
    else onSave(data);
    onClose();
  };

  const handleDelete = () => {
    if (!editBill || !onDelete) return;
    const doDelete = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onDelete(editBill.id);
      onClose();
    };
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert(`Delete ${noun}`, `Delete "${editBill.name}"? All monthly data will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const nonDebtCategories = categories.filter(c => c !== "Debt");
  const inp = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {editBill ? `Edit ${noun}` : `Add ${noun}`}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Name */}
            <Text style={lbl}>{noun} Name</Text>
            <TextInput style={inp} value={name} onChangeText={setName}
              placeholder={`e.g. ${isDebt ? "Car Loan" : "Electric Bill"}`}
              placeholderTextColor={c.mutedForeground} returnKeyType="next" />

            {/* Amount */}
            <Text style={lbl}>Payment Amount ($)</Text>
            <TextInput style={inp} value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            {/* Frequency */}
            <Text style={lbl}>Frequency</Text>
            <View style={[styles.segRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
              {(["monthly", "weekly"] as Bill["frequency"][]).map(f => (
                <Pressable key={f} onPress={() => setFrequency(f)}
                  style={[styles.segBtn, { backgroundColor: frequency === f ? c.primary : "transparent", borderRadius: 8 }]}
                >
                  <Feather name={f === "monthly" ? "calendar" : "repeat"} size={12}
                    color={frequency === f ? c.primaryForeground : c.mutedForeground} />
                  <Text style={[styles.segLabel, { color: frequency === f ? c.primaryForeground : c.mutedForeground }]}>
                    {f === "monthly" ? "Monthly" : "Weekly"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Monthly → calendar day picker; Weekly → day-of-week grid */}
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
            ) : (
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
                    Bill repeats every {WEEKDAYS[dayOfWeek]} of the month — typically 4–5 times.
                  </Text>
                </View>
              </>
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

            {(billStartDate.trim() || billEndDate.trim()) && (
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
                <Switch value={isDebt} onValueChange={setIsDebt}
                  trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
              </View>
            )}

            {/* Debt-specific fields */}
            {isDebt ? (
              <>
                <Text style={lbl}>Current Balance ($)</Text>
                <TextInput style={inp} value={balance} onChangeText={setBalance}
                  placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
                <Text style={lbl}>Interest Rate (% APR)</Text>
                <TextInput style={inp} value={interestRate} onChangeText={setInterestRate}
                  placeholder="0.0" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
                <View style={[styles.toggleCard, { backgroundColor: c.card }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: c.foreground }]}>Include in Snowball</Text>
                    <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Send extra payments to this debt</Text>
                  </View>
                  <Switch value={includeInSnowball} onValueChange={setIncludeInSnowball}
                    trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
                </View>
                <View style={[styles.infoBox, { backgroundColor: c.primary + "15" }]}>
                  <Feather name="info" size={13} color={c.primary} />
                  <Text style={[styles.infoText, { color: c.primary }]}>
                    Payoff priority auto-assigned: lowest balance = #1.
                  </Text>
                </View>
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
            <Pressable onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {editBill ? `Update ${noun}` : `Add ${noun}`}
              </Text>
            </Pressable>

            {/* Delete */}
            {editBill && onDelete && (
              <Pressable onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete {noun}</Text>
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
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "94%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  segRow: { flexDirection: "row", padding: 4, gap: 4 },
  segBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  segLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dowRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dowBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  dowLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 10, borderRadius: 8, marginTop: 8 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  toggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, marginTop: 14 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
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
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

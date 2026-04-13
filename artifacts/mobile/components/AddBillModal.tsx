import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Switch,
  Text, TextInput, View,
} from "react-native";

import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
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
  const [dueDay,        setDueDay]        = useState("1");
  const [dayOfWeek,     setDayOfWeek]     = useState(0);      // 0=Sun … 6=Sat
  const [isRecurring,   setIsRecurring]   = useState(true);
  const [frequency,     setFrequency]     = useState<Bill["frequency"]>("monthly");
  const [billStartDate, setBillStartDate] = useState("");     // YYYY-MM-DD
  const [billEndDate,   setBillEndDate]   = useState("");     // YYYY-MM-DD

  useEffect(() => {
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.is_debt ? "Other" : editBill.category);
      setIsDebt(editBill.is_debt);
      setBalance(editBill.balance > 0 ? editBill.balance.toString() : "");
      setInterestRate(editBill.interest_rate > 0 ? editBill.interest_rate.toString() : "");
      setDueDay(editBill.due_day.toString());
      setDayOfWeek(editBill.day_of_week ?? 0);
      setIsRecurring(editBill.is_recurring);
      setFrequency(editBill.frequency ?? "monthly");
      setBillStartDate(editBill.start_date ?? "");
      setBillEndDate(editBill.end_date ?? "");
    } else {
      setName(""); setAmount(""); setCategory("Other");
      setIsDebt(forceDebt ?? false); setBalance(""); setInterestRate("");
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

            {/* Monthly → due day number; Weekly → day-of-week grid */}
            {frequency === "monthly" ? (
              <>
                <Text style={lbl}>Due Day of Month (1–31)</Text>
                <TextInput style={inp} value={dueDay} onChangeText={setDueDay}
                  placeholder="1" placeholderTextColor={c.mutedForeground}
                  keyboardType="number-pad" maxLength={2} />
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
            <Text style={lbl}>Start Date (optional, YYYY-MM-DD)</Text>
            <TextInput style={inp} value={billStartDate} onChangeText={setBillStartDate}
              placeholder="e.g. 2025-01-01" placeholderTextColor={c.mutedForeground} />

            <Text style={lbl}>End Date (optional, YYYY-MM-DD)</Text>
            <TextInput style={inp} value={billEndDate} onChangeText={setBillEndDate}
              placeholder="Leave blank = indefinite" placeholderTextColor={c.mutedForeground} />

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
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

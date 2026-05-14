import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import colors from "@/constants/colors";
import type { IncomeAmountEntry, IncomeItem } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";

const FREQUENCIES: { key: IncomeItem["frequency"]; label: string; desc: string }[] = [
  { key: "monthly",  label: "Monthly",  desc: "×1/mo" },
  { key: "biweekly", label: "Biweekly", desc: "×2/mo" },
  { key: "weekly",   label: "Weekly",   desc: "×4–5/mo" },
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function yymm(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatYYMM(ef: string) {
  const [y, m] = ef.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: Omit<IncomeItem, "id"> | IncomeItem) => void;
  editItem?: IncomeItem | null;
}

export function IncomeModal({ visible, onClose, onSave, editItem }: Props) {
  const c = useColors();
  const [name,      setName]      = useState("");
  const [amount,    setAmount]    = useState("");
  const [frequency, setFrequency] = useState<IncomeItem["frequency"]>("monthly");
  const [startDate, setStartDate] = useState("");

  // Rate history
  const [history,       setHistory]       = useState<IncomeAmountEntry[]>([]);
  const [showRaiseForm, setShowRaiseForm] = useState(false);
  const [raiseAmount,   setRaiseAmount]   = useState("");
  const [raiseYear,     setRaiseYear]     = useState(new Date().getFullYear());
  const [raiseMonth,    setRaiseMonth]    = useState(new Date().getMonth()); // 0-indexed

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setAmount(editItem.amount.toString());
      setFrequency(editItem.frequency);
      setStartDate(editItem.start_date ?? "");
      setHistory(editItem.amount_history ?? []);
    } else {
      setName(""); setAmount(""); setFrequency("monthly");
      setStartDate(""); setHistory([]);
    }
    setShowRaiseForm(false);
    setRaiseAmount("");
    const now = new Date();
    setRaiseYear(now.getFullYear());
    setRaiseMonth(now.getMonth());
  }, [editItem, visible]);

  const handleSave = () => {
    const a = parseFloat(amount);
    if (!name.trim() || isNaN(a) || a <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<IncomeItem, "id"> = {
      name: name.trim(),
      amount: a,
      frequency,
      start_date: startDate.trim() || undefined,
      amount_history: history.length > 0 ? history : undefined,
    };
    if (editItem) onSave({ ...data, id: editItem.id });
    else onSave(data);
    onClose();
  };

  const handleAddRaise = () => {
    const a = parseFloat(raiseAmount);
    if (isNaN(a) || a <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ef = yymm(raiseYear, raiseMonth);
    setHistory(prev => {
      const filtered = prev.filter(h => h.effective_from !== ef);
      return [...filtered, { effective_from: ef, amount: a }]
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    });
    setRaiseAmount("");
    setShowRaiseForm(false);
  };

  const handleDeleteHistoryEntry = (ef: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHistory(prev => prev.filter(h => h.effective_from !== ef));
  };

  const shiftRaiseMonth = (dir: number) => {
    let m = raiseMonth + dir;
    let y = raiseYear;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setRaiseMonth(m);
    setRaiseYear(y);
  };

  const monthlyEquiv = (() => {
    const a = parseFloat(amount) || 0;
    if (frequency === "weekly")   return a * 4;
    if (frequency === "biweekly") return a * 2;
    return a;
  })();

  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl   = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editItem ? "Edit Income" : "Add Income Source"}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={lbl}>Source Name</Text>
            <TextInput style={input} value={name} onChangeText={setName} placeholder="e.g. Main Job" placeholderTextColor={c.mutedForeground} />

            <Text style={lbl}>Base Amount per Paycheck ($)</Text>
            <TextInput style={input} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            {parseFloat(amount) > 0 && (
              <View style={[styles.equivBadge, { backgroundColor: c.success + "18" }]}>
                <Feather name="trending-up" size={13} color={c.success} />
                <Text style={[styles.equivText, { color: c.success }]}>≈ ${monthlyEquiv.toFixed(0)}/month</Text>
              </View>
            )}

            <Text style={lbl}>Pay Frequency</Text>
            <View style={[styles.freqRow, { backgroundColor: c.muted, borderRadius: 10 }]}>
              {FREQUENCIES.map(f => (
                <Pressable
                  key={f.key}
                  onPress={() => setFrequency(f.key)}
                  style={[styles.freqBtn, { backgroundColor: frequency === f.key ? c.primary : "transparent", borderRadius: 8 }]}
                >
                  <Text style={[styles.freqLabel, { color: frequency === f.key ? c.primaryForeground : c.mutedForeground }]}>{f.label}</Text>
                  <Text style={[styles.freqDesc, { color: frequency === f.key ? c.primaryForeground + "cc" : c.mutedForeground + "88" }]}>{f.desc}</Text>
                </Pressable>
              ))}
            </View>

            <DatePickerField
              label="Start Date — optional"
              value={startDate}
              onChange={setStartDate}
              placeholder="Active immediately"
              optional
            />
            {startDate.trim() !== "" && (
              <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
                <Feather name="calendar" size={12} color={c.primary} />
                <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                  Income only applies for months on or after this date.
                </Text>
              </View>
            )}

            {/* ── Rate History ── */}
            <View style={[styles.historySection, { backgroundColor: c.card, borderRadius: 12 }]}>
              <View style={styles.historyHeader}>
                <View style={styles.historyTitleRow}>
                  <Feather name="trending-up" size={14} color={c.primary} />
                  <Text style={[styles.historyTitle, { color: c.foreground }]}>Raise / Rate Changes</Text>
                </View>
                <Pressable
                  onPress={() => { setShowRaiseForm(p => !p); setRaiseAmount(""); }}
                  style={({ pressed }) => [styles.addRaiseBtn, { backgroundColor: c.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name={showRaiseForm ? "minus" : "plus"} size={13} color={c.primary} />
                  <Text style={[styles.addRaiseBtnText, { color: c.primary }]}>
                    {showRaiseForm ? "Cancel" : "Record Raise"}
                  </Text>
                </Pressable>
              </View>

              {history.length === 0 && !showRaiseForm && (
                <Text style={[styles.historyEmpty, { color: c.mutedForeground }]}>
                  No rate changes yet. Got a raise? Record it here — past months keep their old amount automatically.
                </Text>
              )}

              {/* Existing history entries */}
              {history.map((entry, idx) => (
                <View
                  key={entry.effective_from}
                  style={[styles.historyEntry, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
                >
                  <View style={[styles.historyDot, { backgroundColor: c.primary + "30" }]}>
                    <Feather name="dollar-sign" size={11} color={c.primary} />
                  </View>
                  <View style={styles.historyEntryInfo}>
                    <Text style={[styles.historyEntryAmt, { color: c.foreground }]}>
                      ${entry.amount.toFixed(2)}<Text style={[styles.historyEntryFreq, { color: c.mutedForeground }]}>/{frequency === "monthly" ? "mo" : "paycheck"}</Text>
                    </Text>
                    <Text style={[styles.historyEntryDate, { color: c.mutedForeground }]}>
                      From {formatYYMM(entry.effective_from)} onward
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteHistoryEntry(entry.effective_from)}
                    hitSlop={10}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Feather name="trash-2" size={14} color={c.destructive} />
                  </Pressable>
                </View>
              ))}

              {/* Add raise form */}
              {showRaiseForm && (
                <View style={[styles.raiseForm, { borderTopWidth: history.length > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                  <Text style={[styles.raiseFormLabel, { color: c.mutedForeground }]}>New amount per paycheck ($)</Text>
                  <TextInput
                    style={[styles.raiseInput, { backgroundColor: c.muted, color: c.foreground }]}
                    value={raiseAmount}
                    onChangeText={setRaiseAmount}
                    placeholder="0.00"
                    placeholderTextColor={c.mutedForeground}
                    keyboardType="decimal-pad"
                    autoFocus
                  />

                  <Text style={[styles.raiseFormLabel, { color: c.mutedForeground, marginTop: 10 }]}>Effective starting</Text>
                  <View style={[styles.monthNav, { backgroundColor: c.muted, borderRadius: 10 }]}>
                    <Pressable onPress={() => shiftRaiseMonth(-1)} hitSlop={10} style={styles.monthNavBtn}>
                      <Feather name="chevron-left" size={18} color={c.foreground} />
                    </Pressable>
                    <Text style={[styles.monthNavLabel, { color: c.foreground }]}>
                      {MONTH_NAMES[raiseMonth]} {raiseYear}
                    </Text>
                    <Pressable onPress={() => shiftRaiseMonth(1)} hitSlop={10} style={styles.monthNavBtn}>
                      <Feather name="chevron-right" size={18} color={c.foreground} />
                    </Pressable>
                  </View>

                  <View style={[styles.raiseInfoBox, { backgroundColor: c.primary + "12" }]}>
                    <Feather name="info" size={12} color={c.primary} />
                    <Text style={[styles.raiseInfoText, { color: c.mutedForeground }]}>
                      Months before {MONTH_NAMES[raiseMonth]} {raiseYear} will keep the old amount. Only this month and later will show the new rate.
                    </Text>
                  </View>

                  <Pressable
                    onPress={handleAddRaise}
                    style={({ pressed }) => [styles.confirmRaiseBtn, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Feather name="check" size={15} color={c.primaryForeground} />
                    <Text style={[styles.confirmRaiseBtnText, { color: c.primaryForeground }]}>Save Rate Change</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>{editItem ? "Update" : "Add Income"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "90%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  equivBadge: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, marginTop: 6 },
  equivText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  freqRow: { flexDirection: "row", padding: 4, gap: 4 },
  freqBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  freqLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  freqDesc: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 9, borderRadius: 8, marginTop: 6 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  // Rate history section
  historySection: { marginTop: 20, padding: 14 },
  historyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addRaiseBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addRaiseBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  historyEmpty: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 4 },
  historyEntry: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  historyDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  historyEntryInfo: { flex: 1 },
  historyEntryAmt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  historyEntryFreq: { fontSize: 12, fontFamily: "Inter_400Regular" },
  historyEntryDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  // Raise form
  raiseForm: { paddingTop: 12 },
  raiseFormLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  raiseInput: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 14 },
  monthNavBtn: { padding: 4 },
  monthNavLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  raiseInfoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 9, borderRadius: 8, marginTop: 10 },
  raiseInfoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  confirmRaiseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 10, marginTop: 12 },
  confirmRaiseBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 20, marginBottom: 32 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

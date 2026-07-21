import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import colors from "@/constants/colors";
import type { IncomeAmountEntry, IncomeItem } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { MONTH_NAMES } from "@/lib/dateLabels";

const FREQUENCIES: { key: IncomeItem["frequency"]; label: string; desc: string }[] = [
  { key: "monthly",  label: "Monthly",  desc: "×1/mo"   },
  { key: "biweekly", label: "Biweekly", desc: "×2/mo"   },
  { key: "weekly",   label: "Weekly",   desc: "×4–5/mo" },
];

function formatYYMM(ef: string) {
  const [y, m] = ef.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: Omit<IncomeItem, "id"> | IncomeItem) => void | Promise<unknown>;
  onDelete?: (id: string) => void | Promise<unknown>;
  editItem?: IncomeItem | null;
}

export function IncomeModal({ visible, onClose, onSave, onDelete, editItem }: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const [name,            setName]            = useState("");
  const [amount,          setAmount]          = useState("");
  const [frequency,       setFrequency]       = useState<IncomeItem["frequency"]>("monthly");
  const [firstPayDate,    setFirstPayDate]    = useState("");

  const [history,         setHistory]         = useState<IncomeAmountEntry[]>([]);
  const [showUpdateForm,  setShowUpdateForm]  = useState(false);
  const [raiseAmount,     setRaiseAmount]     = useState("");
  const [raiseDate,       setRaiseDate]       = useState("");
  const [saving,          setSaving]          = useState(false);

  const setMonthlyEdge = (edge: "first" | "last") => {
    const now = new Date();
    if (edge === "first") {
      const target = now.getDate() === 1 ? now : new Date(now.getFullYear(), now.getMonth() + 1, 1);
      setFirstPayDate(`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`);
      return;
    }
    let target = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      target = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    }
    // Day 31 is the recurring "last day" anchor; the calendar safely clamps it for shorter months.
    const anchorMonth = target.getMonth() === 1 ? new Date(target.getFullYear(), 2, 31) : new Date(target.getFullYear(), target.getMonth(), 31);
    setFirstPayDate(`${anchorMonth.getFullYear()}-${String(anchorMonth.getMonth() + 1).padStart(2, "0")}-31`);
  };

  const handleDelete = () => {
    if (!editItem || !onDelete || saving) return;
    Alert.alert(
      "Delete income?",
      `Delete "${editItem.name}" from Income and Calendar?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await onDelete(editItem.id);
              onClose();
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setAmount(editItem.amount.toString());
      setFrequency(editItem.frequency);
      setFirstPayDate(editItem.next_payment_date ?? editItem.start_date ?? "");
      setHistory(editItem.amount_history ?? []);
    } else {
      setName(""); setAmount(""); setFrequency("monthly");
      setFirstPayDate(""); setHistory([]);
    }
    setShowUpdateForm(false);
    setRaiseAmount("");
    const now = new Date();
    setRaiseDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  }, [editItem, visible]);

  const handleSave = async () => {
    if (saving) return;
    const a = parseFloat(amount);
    if (!name.trim() || isNaN(a) || a <= 0) return;
    const payday = firstPayDate.trim();
    if (!payday) {
      Alert.alert("Payday needed", "Choose the date this income should appear on your calendar.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const data: Omit<IncomeItem, "id"> = {
      name: name.trim(),
      amount: a,
      frequency,
      start_date: payday,
      next_payment_date: payday,
      amount_history: history.length > 0 ? history : undefined,
    };
    setSaving(true);
    try {
      if (editItem) await onSave({ ...data, id: editItem.id });
      else await onSave(data);
      onClose();
    } catch (error) {
      Alert.alert("Couldn’t save income", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddUpdate = () => {
    const a = parseFloat(raiseAmount);
    if (isNaN(a) || a <= 0 || !raiseDate) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ef = raiseDate.slice(0, 7);
    setHistory(prev => {
      const filtered = prev.filter(h => h.effective_from !== ef);
      return [...filtered, { effective_from: ef, amount: a }]
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    });
    setRaiseAmount("");
    setShowUpdateForm(false);
  };

  const handleDeleteHistoryEntry = (ef: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHistory(prev => prev.filter(h => h.effective_from !== ef));
  };

  const monthlyEquiv = (() => {
    const a = parseFloat(amount) || 0;
    if (frequency === "weekly")   return (a * 52 / 12);
    if (frequency === "biweekly") return (a * 26 / 12);
    return a;
  })();

  const isRecurring = frequency === "biweekly" || frequency === "weekly";
  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const lbl   = [styles.label, { color: c.mutedForeground }];

  // Preview: compute next few pay dates from firstPayDate
  const payDatePreview = (() => {
    if (!isRecurring || !firstPayDate.trim()) return null;
    const [y, m, d] = firstPayDate.split("-").map(Number);
    if (!y || !m || !d) return null;
    const intervalDays = frequency === "biweekly" ? 14 : 7;
    const anchor = new Date(y, m - 1, d);
    const dates: string[] = [];
    let cur = new Date(anchor.getTime());
    // Walk forward to get the next 4 occurrences from today
    const today = new Date();
    while (cur < today) cur = new Date(cur.getTime() + intervalDays * 86400000);
    for (let i = 0; i < 4; i++) {
      dates.push(`${MONTH_NAMES[cur.getMonth()]} ${cur.getDate()}`);
      cur = new Date(cur.getTime() + intervalDays * 86400000);
    }
    return dates;
  })();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
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

            <Text style={lbl}>Amount per Paycheck ($)</Text>
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
              label={isRecurring ? `First pay date (sets the ${frequency === "biweekly" ? "every-14-day" : "weekly"} schedule)` : "Payday"}
              value={firstPayDate}
              onChange={setFirstPayDate}
              placeholder={isRecurring ? "Pick any known pay date" : "Choose the monthly payday"}
            />
            {frequency === "monthly" ? (
              <View style={styles.monthEdgeRow}>
                <Pressable onPress={() => setMonthlyEdge("first")} style={[styles.monthEdgeButton, { borderColor: c.border, backgroundColor: c.card }]}>
                  <Feather name="skip-back" size={13} color={c.primary} />
                  <Text style={[styles.monthEdgeText, { color: c.foreground }]}>First day</Text>
                </Pressable>
                <Pressable onPress={() => setMonthlyEdge("last")} style={[styles.monthEdgeButton, { borderColor: c.border, backgroundColor: c.card }]}>
                  <Text style={[styles.monthEdgeText, { color: c.foreground }]}>Last day</Text>
                  <Feather name="skip-forward" size={13} color={c.primary} />
                </Pressable>
              </View>
            ) : null}
            <View style={[styles.infoBox, { backgroundColor: c.primary + "12" }]}>
              <Feather name="calendar" size={12} color={c.primary} />
              <Text style={[styles.infoText, { color: c.mutedForeground }]}>
                {isRecurring
                  ? `FlowLedger will place this income every ${frequency === "biweekly" ? "14" : "7"} days from the date you choose.`
                  : "FlowLedger will place this income on this day each month."}
              </Text>
            </View>

            {payDatePreview && (
              <View style={[styles.previewBox, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.previewLabel, { color: c.mutedForeground }]}>Upcoming pay dates</Text>
                <View style={styles.previewDates}>
                  {payDatePreview.map((d, i) => (
                    <View key={i} style={[styles.previewChip, { backgroundColor: c.primary + "18" }]}>
                      <Text style={[styles.previewChipText, { color: c.primary }]}>{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Rate History */}
            <View style={[styles.historySection, { backgroundColor: c.card, borderRadius: 12 }]}>
              <View style={styles.historyHeader}>
                <View style={styles.historyTitleRow}>
                  <Feather name="trending-up" size={14} color={c.primary} />
                  <Text style={[styles.historyTitle, { color: c.foreground }]}>Amount Changes</Text>
                </View>
                <Pressable
                  onPress={() => { setShowUpdateForm(p => !p); setRaiseAmount(""); }}
                  style={({ pressed }) => [styles.addRaiseBtn, { backgroundColor: c.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name={showUpdateForm ? "minus" : "plus"} size={13} color={c.primary} />
                  <Text style={[styles.addRaiseBtnText, { color: c.primary }]}>
                    {showUpdateForm ? "Cancel" : "Record Update"}
                  </Text>
                </Pressable>
              </View>

              {history.length === 0 && !showUpdateForm && (
                <Text style={[styles.historyEmpty, { color: c.mutedForeground }]}>
                  No changes yet. Income go up or down? Record it here.
                </Text>
              )}

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
                    <Text style={[styles.historyEntryDate, { color: c.mutedForeground }]}>From {formatYYMM(entry.effective_from)} onward</Text>
                  </View>
                  <Pressable onPress={() => handleDeleteHistoryEntry(entry.effective_from)} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
                    <Feather name="trash-2" size={14} color={c.destructive} />
                  </Pressable>
                </View>
              ))}

              {showUpdateForm && (
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
                  <DatePickerField label="Effective starting" value={raiseDate} onChange={setRaiseDate} placeholder="Pick a date" />
                  {raiseDate ? (
                    <View style={[styles.raiseInfoBox, { backgroundColor: c.primary + "12" }]}>
                      <Feather name="info" size={12} color={c.primary} />
                      <Text style={[styles.raiseInfoText, { color: c.mutedForeground }]}>
                        Months before {MONTH_NAMES[parseInt(raiseDate.split("-")[1]) - 1]} {raiseDate.split("-")[0]} keep the old amount.
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={handleAddUpdate}
                    style={({ pressed }) => [styles.confirmRaiseBtn, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Feather name="check" size={15} color={c.primaryForeground} />
                    <Text style={[styles.confirmRaiseBtnText, { color: c.primaryForeground }]}>Save Update</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable
              disabled={saving}
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: saving ? 0.55 : pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>{saving ? "Saving…" : editItem ? "Update" : "Add Income"}</Text>
            </Pressable>
            {editItem && onDelete ? (
              <Pressable
                disabled={saving}
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: saving ? 0.55 : pressed ? 0.78 : 1 }]}
              >
                <Feather name="trash-2" size={15} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete Income</Text>
              </Pressable>
            ) : null}
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
  monthEdgeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  monthEdgeButton: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  monthEdgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 9, borderRadius: 8, marginTop: 6 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  previewBox: { marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  previewLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  previewDates: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  previewChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  previewChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

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
  raiseForm: { paddingTop: 12 },
  raiseFormLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  raiseInput: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  raiseInfoBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 9, borderRadius: 8, marginTop: 10 },
  raiseInfoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  confirmRaiseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 10, marginTop: 12 },
  confirmRaiseBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 20, marginBottom: 12 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 32 },
  deleteBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});

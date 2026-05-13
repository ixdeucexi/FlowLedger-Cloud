import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import colors from "@/constants/colors";
import type { IncomeItem } from "@/context/BudgetContext";
import { DatePickerField } from "@/components/DatePickerField";
import { useColors } from "@/hooks/useColors";

const FREQUENCIES: { key: IncomeItem["frequency"]; label: string; desc: string }[] = [
  { key: "monthly", label: "Monthly", desc: "×1/mo" },
  { key: "biweekly", label: "Biweekly", desc: "×2/mo" },
  { key: "weekly", label: "Weekly", desc: "×4–5/mo" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: Omit<IncomeItem, "id"> | IncomeItem) => void;
  editItem?: IncomeItem | null;
}

export function IncomeModal({ visible, onClose, onSave, editItem }: Props) {
  const c = useColors();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<IncomeItem["frequency"]>("monthly");
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setAmount(editItem.amount.toString());
      setFrequency(editItem.frequency);
      setStartDate(editItem.start_date ?? "");
    } else {
      setName(""); setAmount(""); setFrequency("monthly");
      setStartDate("");
    }
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
    };
    if (editItem) onSave({ ...data, id: editItem.id });
    else onSave(data);
    onClose();
  };

  const monthlyEquiv = (() => {
    const a = parseFloat(amount) || 0;
    if (frequency === "weekly")   return a * 4;   // 4 as a conservative estimate (may be 5 in some months)
    if (frequency === "biweekly") return a * 2;
    return a;
  })();

  const input = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const label = [styles.label, { color: c.mutedForeground }];

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
            <Text style={label}>Source Name</Text>
            <TextInput style={input} value={name} onChangeText={setName} placeholder="e.g. Main Job" placeholderTextColor={c.mutedForeground} />

            <Text style={label}>Amount per Paycheck ($)</Text>
            <TextInput style={input} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            {parseFloat(amount) > 0 && (
              <View style={[styles.equivBadge, { backgroundColor: c.success + "18" }]}>
                <Feather name="trending-up" size={13} color={c.success} />
                <Text style={[styles.equivText, { color: c.success }]}>
                  ≈ ${monthlyEquiv.toFixed(0)}/month
                </Text>
              </View>
            )}

            <Text style={label}>Pay Frequency</Text>
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
              <View style={[styles.startDateNote, { backgroundColor: c.primary + "12" }]}>
                <Feather name="calendar" size={12} color={c.primary} />
                <Text style={[styles.startDateText, { color: c.mutedForeground }]}>
                  Income only applies for months on or after this date.
                </Text>
              </View>
            )}

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
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "82%" },
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
  startDateNote: { flexDirection: "row", alignItems: "center", gap: 7, padding: 9, borderRadius: 8, marginTop: 6 },
  startDateText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24, marginBottom: 32 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

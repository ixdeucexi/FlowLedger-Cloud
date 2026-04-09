import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import colors from "@/constants/colors";
import type { IncomeItem } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const FREQUENCIES: { key: IncomeItem["frequency"]; label: string; desc: string }[] = [
  { key: "monthly", label: "Monthly", desc: "×1/mo" },
  { key: "biweekly", label: "Biweekly", desc: "×2.17/mo" },
  { key: "weekly", label: "Weekly", desc: "×4.33/mo" },
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

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      setAmount(editItem.amount.toString());
      setFrequency(editItem.frequency);
    } else {
      setName(""); setAmount(""); setFrequency("monthly");
    }
  }, [editItem, visible]);

  const handleSave = () => {
    const a = parseFloat(amount);
    if (!name.trim() || isNaN(a) || a <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<IncomeItem, "id"> = { name: name.trim(), amount: a, frequency };
    if (editItem) onSave({ ...data, id: editItem.id });
    else onSave(data);
    onClose();
  };

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
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={label}>Source Name</Text>
            <TextInput style={input} value={name} onChangeText={setName} placeholder='e.g. Main Job' placeholderTextColor={c.mutedForeground} />

            <Text style={label}>Amount per Paycheck ($)</Text>
            <TextInput style={input} value={amount} onChangeText={setAmount} placeholder='0.00' placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <Text style={label}>Pay Frequency</Text>
            <View style={styles.freqRow}>
              {FREQUENCIES.map(f => (
                <Pressable
                  key={f.key}
                  onPress={() => setFrequency(f.key)}
                  style={[styles.freqBtn, { backgroundColor: frequency === f.key ? c.primary : c.muted, borderRadius: 10 }]}
                >
                  <Text style={[styles.freqLabel, { color: frequency === f.key ? c.primaryForeground : c.foreground }]}>{f.label}</Text>
                  <Text style={[styles.freqDesc, { color: frequency === f.key ? c.primaryForeground + "cc" : c.mutedForeground }]}>{f.desc}</Text>
                </Pressable>
              ))}
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
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 12, maxHeight: "80%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  input: { height: 48, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  freqRow: { flexDirection: "row", gap: 8 },
  freqBtn: { flex: 1, padding: 12, alignItems: "center" },
  freqLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  freqDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24, marginBottom: 32 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

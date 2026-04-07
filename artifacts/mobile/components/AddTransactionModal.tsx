import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import type { Transaction } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const TX_CATEGORIES = [
  "Food", "Transport", "Shopping", "Health", "Entertainment",
  "Income", "Utilities", "Rent", "Debt Payment", "Other",
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (tx: Omit<Transaction, "id"> | Transaction) => void;
  editTx?: Transaction | null;
  defaultDate?: string;
}

export function AddTransactionModal({ visible, onClose, onSave, editTx, defaultDate }: Props) {
  const c = useColors();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().split("T")[0]);
  const [isExpense, setIsExpense] = useState(true);

  useEffect(() => {
    if (editTx) {
      setAmount(Math.abs(editTx.amount).toString());
      setCategory(editTx.category);
      setNote(editTx.note);
      setDate(editTx.date);
      setIsExpense(editTx.amount < 0);
    } else {
      setAmount("");
      setCategory("Other");
      setNote("");
      setDate(defaultDate ?? new Date().toISOString().split("T")[0]);
      setIsExpense(true);
    }
  }, [editTx, visible, defaultDate]);

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Transaction, "id"> = {
      amount: isExpense ? -parsed : parsed,
      category,
      note: note.trim(),
      date,
    };
    if (editTx) onSave({ ...data, id: editTx.id });
    else onSave(data);
    onClose();
  };

  const inputStyle = [styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }];
  const labelStyle = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editTx ? "Edit Transaction" : "Add Transaction"}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={[styles.typeToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
              <Pressable
                onPress={() => setIsExpense(true)}
                style={[styles.typeBtn, { backgroundColor: isExpense ? c.destructive : "transparent", borderRadius: 8 }]}
              >
                <Text style={[styles.typeBtnText, { color: isExpense ? "#fff" : c.mutedForeground }]}>Expense</Text>
              </Pressable>
              <Pressable
                onPress={() => setIsExpense(false)}
                style={[styles.typeBtn, { backgroundColor: !isExpense ? c.success : "transparent", borderRadius: 8 }]}
              >
                <Text style={[styles.typeBtnText, { color: !isExpense ? "#fff" : c.mutedForeground }]}>Income</Text>
              </Pressable>
            </View>

            <Text style={labelStyle}>Amount ($)</Text>
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <Text style={labelStyle}>Date</Text>
            <TextInput style={inputStyle} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={c.mutedForeground} />

            <Text style={labelStyle}>Note</Text>
            <TextInput style={inputStyle} value={note} onChangeText={setNote} placeholder="What was it for?" placeholderTextColor={c.mutedForeground} />

            <Text style={labelStyle}>Category</Text>
            <View style={styles.categoryGrid}>
              {TX_CATEGORIES.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.chip, { backgroundColor: category === cat ? c.primary : c.muted, borderRadius: 8 }]}
                >
                  <Text style={[styles.chipText, { color: category === cat ? c.primaryForeground : c.mutedForeground }]}>{cat}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>{editTx ? "Update" : "Add Transaction"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  typeToggle: { flexDirection: "row", padding: 4, gap: 4, marginBottom: 4 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  typeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24, marginBottom: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

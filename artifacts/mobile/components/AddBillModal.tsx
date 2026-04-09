import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import type { Bill } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const CATEGORIES = [
  "Housing", "Utilities", "Insurance", "Transportation",
  "Food", "Entertainment", "Health", "Education",
  "Savings", "Other",
];

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
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [isDebt, setIsDebt] = useState(false);
  const [balance, setBalance] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [isRecurring, setIsRecurring] = useState(true);

  useEffect(() => {
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.category === "Debt" ? "Other" : editBill.category);
      setIsDebt(editBill.is_debt);
      setBalance(editBill.balance > 0 ? editBill.balance.toString() : "");
      setInterestRate(editBill.interest_rate > 0 ? editBill.interest_rate.toString() : "");
      setDueDay(editBill.due_day.toString());
      setIsRecurring(editBill.is_recurring);
    } else {
      setName(""); setAmount(""); setCategory("Other");
      setIsDebt(forceDebt ?? false); setBalance("");
      setInterestRate(""); setDueDay("1"); setIsRecurring(true);
    }
  }, [editBill, visible, forceDebt]);

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
      is_recurring: isRecurring,
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
    if (Platform.OS === "web") {
      doDelete();
      return;
    }
    Alert.alert(
      "Delete Bill",
      `Are you sure you want to delete "${editBill.name}"? This will also remove all monthly data for this bill.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]
    );
  };

  const inputStyle = [styles.input, { backgroundColor: c.muted, color: c.foreground }];
  const labelStyle = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editBill ? "Edit Bill" : "Add Bill"}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={labelStyle}>Bill Name</Text>
            <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Electric Bill" placeholderTextColor={c.mutedForeground} returnKeyType="next" />

            <Text style={labelStyle}>Monthly Payment ($)</Text>
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <Text style={labelStyle}>Due Day of Month</Text>
            <TextInput style={inputStyle} value={dueDay} onChangeText={setDueDay} placeholder="1–31" placeholderTextColor={c.mutedForeground} keyboardType="number-pad" maxLength={2} />

            <View style={[styles.toggleCard, { backgroundColor: c.card }]}>
              <View>
                <Text style={[styles.toggleLabel, { color: c.foreground }]}>This is a Debt</Text>
                <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Tracks balance, interest &amp; payoff</Text>
              </View>
              <Switch value={isDebt} onValueChange={setIsDebt} trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
            </View>

            {isDebt ? (
              <>
                <Text style={labelStyle}>Current Balance ($)</Text>
                <TextInput style={inputStyle} value={balance} onChangeText={setBalance} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

                <Text style={labelStyle}>Interest Rate (% APR)</Text>
                <TextInput style={inputStyle} value={interestRate} onChangeText={setInterestRate} placeholder="0.0" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

                <View style={[styles.debtNote, { backgroundColor: c.primary + "15", borderRadius: 8 }]}>
                  <Feather name="info" size={13} color={c.primary} />
                  <Text style={[styles.debtNoteText, { color: c.primary }]}>
                    Payoff priority is auto-assigned based on balance (lowest = first).
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={labelStyle}>Category</Text>
                <View style={styles.categoryGrid}>
                  {CATEGORIES.map(cat => (
                    <Pressable
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[styles.chip, { backgroundColor: category === cat ? c.primary : c.muted, borderRadius: 8 }]}
                    >
                      <Text style={[styles.chipText, { color: category === cat ? c.primaryForeground : c.mutedForeground }]}>{cat}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <View style={[styles.toggleCard, { backgroundColor: c.card, marginTop: 14 }]}>
              <View>
                <Text style={[styles.toggleLabel, { color: c.foreground }]}>Recurring Monthly</Text>
                <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Appears automatically each month</Text>
              </View>
              <Switch value={isRecurring} onValueChange={setIsRecurring} trackColor={{ false: c.muted, true: c.primary }} thumbColor="#fff" />
            </View>

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {editBill ? "Update Bill" : "Add Bill"}
              </Text>
            </Pressable>

            {editBill && onDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="trash-2" size={16} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete Bill</Text>
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
  toggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, marginTop: 14 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  debtNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginTop: 12 },
  debtNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1.5, borderRadius: 12, marginTop: 12, marginBottom: 32 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

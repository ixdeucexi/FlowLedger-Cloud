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
  "Savings", "Debt", "Other",
];

interface AddBillModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (bill: Omit<Bill, "id" | "created_at"> | Bill) => void;
  editBill?: Bill | null;
}

export function AddBillModal({ visible, onClose, onSave, editBill }: AddBillModalProps) {
  const c = useColors();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [priority, setPriority] = useState("1");
  const [isDebt, setIsDebt] = useState(false);
  const [balance, setBalance] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [isRecurring, setIsRecurring] = useState(true);

  useEffect(() => {
    if (editBill) {
      setName(editBill.name);
      setAmount(editBill.amount.toString());
      setCategory(editBill.category);
      setPriority(editBill.priority.toString());
      setIsDebt(editBill.is_debt);
      setBalance(editBill.balance > 0 ? editBill.balance.toString() : "");
      setInterestRate(editBill.interest_rate > 0 ? editBill.interest_rate.toString() : "");
      setDueDay(editBill.due_day.toString());
      setIsRecurring(editBill.is_recurring);
    } else {
      setName(""); setAmount(""); setCategory("Other"); setPriority("1");
      setIsDebt(false); setBalance(""); setInterestRate("");
      setDueDay("1"); setIsRecurring(true);
    }
  }, [editBill, visible]);

  const handleSave = () => {
    const parsedAmount = parseFloat(amount);
    if (!name.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Bill, "id" | "created_at"> = {
      name: name.trim(),
      amount: parsedAmount,
      category: isDebt ? "Debt" : category,
      priority: parseInt(priority) || 1,
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

  const inputStyle = [styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }];
  const labelStyle = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editBill ? "Edit Bill" : "Add Bill"}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={labelStyle}>Bill Name</Text>
            <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Electric Bill" placeholderTextColor={c.mutedForeground} />

            <Text style={labelStyle}>Monthly Payment Amount ($)</Text>
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Due Day</Text>
                <TextInput style={inputStyle} value={dueDay} onChangeText={setDueDay} placeholder="1" placeholderTextColor={c.mutedForeground} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Priority</Text>
                <TextInput style={inputStyle} value={priority} onChangeText={setPriority} placeholder="1" placeholderTextColor={c.mutedForeground} keyboardType="number-pad" maxLength={2} />
              </View>
            </View>

            <View style={[styles.toggleRow, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              <View>
                <Text style={[styles.toggleLabel, { color: c.foreground }]}>Is a Debt</Text>
                <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Tracks balance + interest</Text>
              </View>
              <Switch
                value={isDebt}
                onValueChange={setIsDebt}
                trackColor={{ false: c.muted, true: c.primary }}
                thumbColor="#fff"
              />
            </View>

            {isDebt && (
              <>
                <Text style={labelStyle}>Current Balance ($)</Text>
                <TextInput style={inputStyle} value={balance} onChangeText={setBalance} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
                <Text style={labelStyle}>Interest Rate (%)</Text>
                <TextInput style={inputStyle} value={interestRate} onChangeText={setInterestRate} placeholder="0.0" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />
              </>
            )}

            <View style={[styles.toggleRow, { backgroundColor: c.card, borderRadius: colors.radius }]}>
              <View>
                <Text style={[styles.toggleLabel, { color: c.foreground }]}>Recurring Monthly</Text>
                <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>Shows up every month</Text>
              </View>
              <Switch
                value={isRecurring}
                onValueChange={setIsRecurring}
                trackColor={{ false: c.muted, true: c.primary }}
                thumbColor="#fff"
              />
            </View>

            {!isDebt && (
              <>
                <Text style={labelStyle}>Category</Text>
                <View style={styles.categoryGrid}>
                  {CATEGORIES.filter(c => c !== "Debt").map(cat => (
                    <Pressable
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[
                        styles.chip,
                        { backgroundColor: category === cat ? c.primary : c.muted, borderRadius: colors.radius },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: category === cat ? c.primaryForeground : c.mutedForeground }]}>
                        {cat}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {editBill ? "Update Bill" : "Add Bill"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "90%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, marginTop: 14 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 24, marginBottom: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

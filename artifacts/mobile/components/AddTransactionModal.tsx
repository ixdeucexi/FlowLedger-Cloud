import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
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
import { DatePickerField } from "@/components/DatePickerField";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { sortDebtsLeastToGreatest } from "@/lib/debtOrder";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (tx: Omit<Transaction, "id"> | Transaction) => void;
  onDelete?: (id: string) => void;
  editTx?: Transaction | null;
  defaultDate?: string;
}

export function AddTransactionModal({ visible, onClose, onSave, onDelete, editTx, defaultDate }: Props) {
  const c = useColors();
  const { categories, accounts, bills } = useBudget();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().split("T")[0]);
  const [isExpense, setIsExpense] = useState(true);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [linkedBillId, setLinkedBillId] = useState<string | undefined>();
  const activeDebts = useMemo(
    () => sortDebtsLeastToGreatest(bills.filter(bill => bill.is_debt && bill.balance > 0)),
    [bills],
  );

  useEffect(() => {
    if (editTx) {
      setAmount(Math.abs(editTx.amount).toString());
      setCategory(editTx.category);
      setNote(editTx.note);
      setDate(editTx.date);
      setIsExpense(editTx.amount < 0);
      setAccountId(editTx.account_id);
      setLinkedBillId(editTx.linked_bill_id);
    } else {
      const init = defaultDate ?? new Date().toISOString().split("T")[0];
      setAmount("");
      setCategory("Other");
      setNote("");
      setDate(init);
      setIsExpense(true);
      setAccountId(accounts.find(account => account.is_active)?.id);
      setLinkedBillId(undefined);
    }
  }, [editTx, visible, defaultDate, accounts]);

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const data: Omit<Transaction, "id"> = {
      amount: isExpense ? -parsed : parsed,
      category,
      note: note.trim(),
      date,
      account_id: accountId,
      linked_bill_id: isExpense ? linkedBillId : undefined,
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

            <DatePickerField label="Date" value={date} onChange={setDate} placeholder="Choose transaction date" />

            <Text style={labelStyle}>Note</Text>
            <TextInput style={inputStyle} value={note} onChangeText={setNote} placeholder="What was it for?" placeholderTextColor={c.mutedForeground} />

            <Text style={labelStyle}>Category</Text>
            <View style={styles.categoryGrid}>
              {categories.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.chip, { backgroundColor: category === cat ? c.primary : c.muted, borderRadius: 8 }]}
                >
                  <Text style={[styles.chipText, { color: category === cat ? c.primaryForeground : c.mutedForeground }]}>{cat}</Text>
                </Pressable>
              ))}
            </View>

            {isExpense && activeDebts.length > 0 && <>
              <Text style={labelStyle}>Apply Toward Debt (Optional)</Text>
              <Text style={[styles.helpText, { color: c.mutedForeground }]}>The payment stays on the calendar and reduces the selected debt when this date arrives.</Text>
              <View style={styles.categoryGrid}>
                <Pressable onPress={() => setLinkedBillId(undefined)} style={[styles.chip, { backgroundColor: !linkedBillId ? c.primary : c.muted, borderRadius: 8 }]}>
                  <Text style={[styles.chipText, { color: !linkedBillId ? c.primaryForeground : c.mutedForeground }]}>No debt</Text>
                </Pressable>
                {activeDebts.map(debt => (
                  <Pressable
                    key={debt.id}
                    onPress={() => { setLinkedBillId(debt.id); setCategory("Debt"); if (!note.trim()) setNote(debt.name); }}
                    style={[styles.chip, { backgroundColor: linkedBillId === debt.id ? c.primary : c.muted, borderRadius: 8 }]}
                  >
                    <Text style={[styles.chipText, { color: linkedBillId === debt.id ? c.primaryForeground : c.mutedForeground }]}>{debt.name} · ${debt.balance.toFixed(2)}</Text>
                  </Pressable>
                ))}
              </View>
            </>}

            {accounts.some(account => account.is_active) && <>
              <Text style={labelStyle}>Account</Text>
              <View style={styles.categoryGrid}>
                {accounts.filter(account => account.is_active).map(account => <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.chip, { backgroundColor: accountId === account.id ? c.primary : c.muted, borderRadius: 8 }]}><Text style={[styles.chipText, { color: accountId === account.id ? c.primaryForeground : c.mutedForeground }]}>{account.name}</Text></Pressable>)}
              </View>
            </>}

            {editTx && onDelete && (
              <Pressable
                onPress={() => { onDelete(editTx.id); onClose(); }}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="trash-2" size={15} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>Delete Transaction</Text>
              </Pressable>
            )}

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
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "90%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  typeToggle: { flexDirection: "row", padding: 4, gap: 4, marginBottom: 4 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  typeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  helpText: { fontSize: 11, lineHeight: 16, marginBottom: 5 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  deleteBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderWidth: 1, borderRadius: 12, marginTop: 20 },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  saveBtn: { height: 52, alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 24 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});

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
  Text,
  TextInput,
  View,
} from "react-native";

import colors from "@/constants/colors";
import { DatePickerField } from "@/components/DatePickerField";
import { FloSafetyStopModal } from "@/components/FloSafetyStopModal";
import type { Transaction } from "@/context/BudgetContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { buildSafetyStop, type SafetyStopWarning } from "@/lib/safetyStop";
import { confirmAction } from "@/lib/confirmAction";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (tx: Omit<Transaction, "id"> | Transaction) => void | Promise<unknown>;
  onDelete?: (id: string) => void | Promise<unknown>;
  onDeleteTransfer?: (transferGroupId: string) => void | Promise<unknown>;
  editTx?: Transaction | null;
  defaultDate?: string;
}

export function AddTransactionModal({ visible, onClose, onSave, onDelete, onDeleteTransfer, editTx, defaultDate }: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);
  const { categories, accounts, bills, transactions, settings, getDailyBalances } = useBudget();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().split("T")[0]);
  const [isExpense, setIsExpense] = useState(true);
  const [isTransfer, setIsTransfer] = useState(false);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [transferToAccountId, setTransferToAccountId] = useState<string | undefined>();
  const [linkedBillId, setLinkedBillId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [safetyStop, setSafetyStop] = useState<SafetyStopWarning | null>(null);
  const [pendingStandardTx, setPendingStandardTx] = useState<Omit<Transaction, "id"> | Transaction | null>(null);
  const transferMate = editTx?.transfer_group_id
    ? transactions.find(transaction => transaction.transfer_group_id === editTx.transfer_group_id && transaction.id !== editTx.id)
    : undefined;
  const activeDebts = bills
    .filter(bill => bill.is_debt && Number(bill.balance) > 0)
    .slice()
    .sort((left, right) =>
      Number(left.balance) - Number(right.balance) || left.name.localeCompare(right.name),
    );

  useEffect(() => {
    if (editTx) {
      setAmount(Math.abs(editTx.amount).toString());
      setCategory(editTx.category);
      setNote(editTx.note);
      setDate(editTx.date);
      setIsExpense(editTx.amount < 0);
      setIsTransfer(Boolean(editTx.transfer_group_id));
      setAccountId(editTx.amount < 0 ? editTx.account_id : transferMate?.account_id);
      setTransferToAccountId(editTx.amount < 0 ? transferMate?.account_id : editTx.account_id);
      setLinkedBillId(editTx.linked_bill_id);
    } else {
      const init = defaultDate ?? new Date().toISOString().split("T")[0];
      setAmount("");
      setCategory("Other");
      setNote("");
      setDate(init);
      setIsExpense(true);
      setIsTransfer(false);
      setAccountId(accounts.find(account => account.is_active)?.id);
      setTransferToAccountId(accounts.filter(account => account.is_active)[1]?.id);
      setLinkedBillId(undefined);
    }
  }, [editTx, visible, defaultDate, accounts, transferMate]);

  const buildForecastBaseline = (startDate: string) => {
    const [startYear, startMonth] = startDate.split("-").map(Number);
    if (!startYear || !startMonth) return [];
    const monthsToCheck = Math.max(1, settings.forecast_horizon_months || 6);
    const output: { date: string; balance: number }[] = [];
    for (let index = 0; index < monthsToCheck; index += 1) {
      const target = new Date(startYear, startMonth - 1 + index, 1);
      const month = target.getMonth();
      const year = target.getFullYear();
      getDailyBalances(month, year).forEach(day => {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
        if (key >= startDate) output.push({ date: key, balance: day.balance });
      });
    }
    return output.sort((left, right) => left.date.localeCompare(right.date));
  };

  const previewSafetyStop = (tx: Omit<Transaction, "id"> | Transaction) => {
    const expenseAmount = tx.amount < 0 ? Math.abs(tx.amount) : 0;
    const existingExpense = editTx?.amount && editTx.amount < 0 ? Math.abs(editTx.amount) : 0;
    const additionalExpense = editTx ? Math.max(0, expenseAmount - existingExpense) : expenseAmount;
    if (additionalExpense <= 0) return null;
    const linkedDebtName = tx.linked_bill_id ? bills.find(bill => bill.id === tx.linked_bill_id)?.name : undefined;
    const itemName = tx.note?.trim() || linkedDebtName || tx.category || "this scheduled item";
    return buildSafetyStop({
      baseline: buildForecastBaseline(tx.date),
      safetyFloor: settings.safety_floor,
      scenario: {
        type: tx.linked_bill_id ? "extra_debt_payment" : "one_time_purchase",
        name: itemName,
        amount: additionalExpense,
        date: tx.date,
        frequency: "once",
      },
    });
  };

  const saveStandardTransaction = async (payload: Omit<Transaction, "id"> | Transaction) => {
    setSaving(true);
    try {
      await onSave(payload);
      setPendingStandardTx(null);
      setSafetyStop(null);
      onClose();
    } catch (error) {
      Alert.alert("Could not save transaction", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    if (isTransfer && (!accountId || !transferToAccountId || accountId === transferToAccountId)) {
      Alert.alert("Choose two accounts", "Pick a different from and to account for this transfer.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isTransfer) {
      const fromName = accounts.find(account => account.id === accountId)?.name ?? "account";
      const toName = accounts.find(account => account.id === transferToAccountId)?.name ?? "account";
      const transferGroupId = editTx?.transfer_group_id ?? `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setSaving(true);
      const createdIds: string[] = [];
      try {
        const fromTx = editTx && editTx.amount < 0 ? editTx : transferMate;
        const toTx = editTx && editTx.amount >= 0 ? editTx : transferMate;
        const fromPayload = {
          amount: -parsed,
          category: "Transfer",
          note: note.trim() || `Transfer to ${toName}`,
          date,
          account_id: accountId,
          transfer_group_id: transferGroupId,
        };
        const toPayload = {
          amount: parsed,
          category: "Transfer",
          note: note.trim() || `Transfer from ${fromName}`,
          date,
          account_id: transferToAccountId,
          transfer_group_id: transferGroupId,
        };
        const fromResult = await onSave(fromTx ? { ...fromPayload, id: fromTx.id } : fromPayload);
        if (!fromTx && typeof fromResult === "string") createdIds.push(fromResult);
        const toResult = await onSave(toTx ? { ...toPayload, id: toTx.id } : toPayload);
        if (!toTx && typeof toResult === "string") createdIds.push(toResult);
        onClose();
      } catch (error) {
        if (createdIds.length > 0 && onDelete) {
          await Promise.allSettled(createdIds.map(id => onDelete(id)));
        }
        Alert.alert("Could not save transfer", error instanceof Error ? error.message : "Please try again.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const data: Omit<Transaction, "id"> = {
      amount: isExpense ? -parsed : parsed,
      category,
      note: note.trim(),
      date,
      account_id: accountId,
      linked_bill_id: isExpense ? linkedBillId : undefined,
    };
    const payload = editTx ? { ...editTx, ...data, id: editTx.id } : data;
    const warning = previewSafetyStop(payload);
    if (warning) {
      setPendingStandardTx(payload);
      setSafetyStop(warning);
      return;
    }
    await saveStandardTransaction(payload);
    return;
    /*
    setSaving(true);
    try {
      if (editTx?.id) await onSave({ ...data, id: editTx.id });
      else await onSave(data);
      onClose();
    } catch (error) {
      Alert.alert("Couldn’t save transaction", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
    */
  };

  const handleDelete = async () => {
    if (!editTx || !onDelete || saving) return;
    const isEditingTransfer = Boolean(editTx.transfer_group_id);
    const runDelete = async () => {
      setSaving(true);
      try {
        if (isEditingTransfer && editTx.transfer_group_id && onDeleteTransfer) await onDeleteTransfer(editTx.transfer_group_id);
        else await onDelete(editTx.id);
        onClose();
      } catch (error) {
        Alert.alert(isEditingTransfer ? "Couldn’t delete transfer" : "Couldn’t delete transaction", error instanceof Error ? error.message : "Please try again.");
      } finally {
        setSaving(false);
      }
    };
    confirmAction({
      title: isEditingTransfer ? "Delete Transfer" : "Delete Transaction",
      message: isEditingTransfer ? "Remove both sides of this transfer?" : "Remove this transaction?",
      confirmText: "Delete",
      destructive: true,
      onConfirm: runDelete,
    });
  };

  const inputStyle = [styles.input, { backgroundColor: c.card, color: c.foreground, borderColor: c.border }];
  const labelStyle = [styles.label, { color: c.mutedForeground }];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.foreground }]}>{editTx ? "Edit Transaction" : "Add Transaction"}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={[styles.typeToggle, { backgroundColor: c.muted, borderRadius: 10 }]}>
              <Pressable
                onPress={() => { setIsTransfer(false); setIsExpense(true); }}
                style={[styles.typeBtn, { backgroundColor: !isTransfer && isExpense ? c.destructive : "transparent", borderRadius: 8 }]}
              >
                <Text style={[styles.typeBtnText, { color: !isTransfer && isExpense ? "#fff" : c.mutedForeground }]}>Expense</Text>
              </Pressable>
              <Pressable
                onPress={() => { setIsTransfer(false); setIsExpense(false); }}
                style={[styles.typeBtn, { backgroundColor: !isTransfer && !isExpense ? c.success : "transparent", borderRadius: 8 }]}
              >
                <Text style={[styles.typeBtnText, { color: !isTransfer && !isExpense ? "#fff" : c.mutedForeground }]}>Income</Text>
              </Pressable>
              {(!editTx || editTx.transfer_group_id) && accounts.filter(account => account.is_active).length >= 2 && (
                <Pressable
                  onPress={() => { setIsTransfer(true); setLinkedBillId(undefined); setCategory("Transfer"); }}
                  style={[styles.typeBtn, { backgroundColor: isTransfer ? c.primary : "transparent", borderRadius: 8 }]}
                >
                  <Text style={[styles.typeBtnText, { color: isTransfer ? c.primaryForeground : c.mutedForeground }]}>Transfer</Text>
                </Pressable>
              )}
            </View>

            <Text style={labelStyle}>Amount ($)</Text>
            <TextInput style={inputStyle} value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={c.mutedForeground} keyboardType="decimal-pad" />

            <DatePickerField label="Date" value={date} onChange={setDate} placeholder="Choose transaction date" />

            <Text style={labelStyle}>Note</Text>
            <TextInput style={inputStyle} value={note} onChangeText={setNote} placeholder="What was it for?" placeholderTextColor={c.mutedForeground} />

            {!isTransfer && <>
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
            </>}

            {!isTransfer && isExpense && activeDebts.length > 0 && <>
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
              <Text style={labelStyle}>{isTransfer ? "From account" : "Account"}</Text>
              <View style={styles.categoryGrid}>
                {accounts.filter(account => account.is_active).map(account => <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.chip, { backgroundColor: accountId === account.id ? c.primary : c.muted, borderRadius: 8 }]}><Text style={[styles.chipText, { color: accountId === account.id ? c.primaryForeground : c.mutedForeground }]}>{account.name}</Text></Pressable>)}
              </View>
            </>}

            {isTransfer && accounts.some(account => account.is_active) && <>
              <Text style={labelStyle}>To account</Text>
              <View style={styles.categoryGrid}>
                {accounts.filter(account => account.is_active).map(account => <Pressable key={account.id} onPress={() => setTransferToAccountId(account.id)} style={[styles.chip, { backgroundColor: transferToAccountId === account.id ? c.primary : c.muted, borderRadius: 8 }]}><Text style={[styles.chipText, { color: transferToAccountId === account.id ? c.primaryForeground : c.mutedForeground }]}>{account.name}</Text></Pressable>)}
              </View>
            </>}

            {editTx && onDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, { borderColor: c.destructive, opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="trash-2" size={15} color={c.destructive} />
                <Text style={[styles.deleteBtnText, { color: c.destructive }]}>{editTx.transfer_group_id ? "Delete Transfer" : "Delete Transaction"}</Text>
              </Pressable>
            )}

            <Pressable
              disabled={saving}
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: c.primary, borderRadius: colors.radius, opacity: saving ? 0.55 : pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>{saving ? "Saving…" : editTx ? "Update" : isTransfer ? "Add Transfer" : "Add Transaction"}</Text>
            </Pressable>
          </ScrollView>
        </View>
        <FloSafetyStopModal
          visible={Boolean(safetyStop)}
          warning={safetyStop}
          onKeepEditing={() => {
            setSafetyStop(null);
            setPendingStandardTx(null);
          }}
          onScheduleAnyway={pendingStandardTx ? () => { void saveStandardTransaction(pendingStandardTx); } : undefined}
        />
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

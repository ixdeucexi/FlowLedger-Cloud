import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DatePickerField } from "@/components/DatePickerField";
import type { Account } from "@/context/BudgetContext";
import type { AccountType } from "@/lib/accounts";
import { useColors } from "@/hooks/useColors";

const TYPES: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" }, { value: "savings", label: "Savings" },
  { value: "cash", label: "Cash" },
];

export function AccountModal({ visible, account, mode, onClose, onSave, onReconcile }: {
  visible: boolean;
  account?: Account | null;
  mode: "add" | "edit" | "reconcile";
  onClose: () => void;
  onSave: (value: { name: string; account_type: AccountType; current_balance: number; balance_as_of: string }) => void | Promise<void>;
  onReconcile: (balance: number, asOfDate: string) => void | Promise<void>;
}) {
  const c = useColors();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(account?.name ?? ""); setType(account?.account_type ?? "checking");
    setBalance(account ? Math.abs(account.current_balance).toString() : "");
    setDate(account?.balance_as_of ?? new Date().toISOString().slice(0, 10));
  }, [account, visible]);
  const submit = async () => {
    if (saving) return;
    const amount = Number(balance);
    if (!Number.isFinite(amount) || !date || (mode !== "reconcile" && !name.trim())) return;
    setSaving(true);
    try {
      if (mode === "reconcile") await onReconcile(amount, date);
      else await onSave({ name: name.trim(), account_type: type, current_balance: amount, balance_as_of: date });
      onClose();
    } catch (error) {
      Alert.alert("Couldn’t save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return <Modal visible={visible} animationType="slide" transparent>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
      <View style={[styles.sheet, { backgroundColor: c.background }]}>
        <View style={styles.header}><Text style={[styles.title, { color: c.foreground }]}>{mode === "reconcile" ? `Reconcile ${account?.name ?? "Account"}` : account ? "Edit Account" : "Add Account"}</Text><Pressable onPress={onClose}><Feather name="x" size={22} color={c.mutedForeground} /></Pressable></View>
        {mode !== "reconcile" && <>
          <Text style={[styles.label, { color: c.mutedForeground }]}>Account name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Main checking" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, backgroundColor: c.card, borderColor: c.border }]} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Type</Text>
          <View style={styles.types}>{TYPES.map(option => <Pressable key={option.value} onPress={() => setType(option.value)} style={[styles.type, { backgroundColor: type === option.value ? c.primary : c.muted }]}><Text style={[styles.typeText, { color: type === option.value ? c.primaryForeground : c.mutedForeground }]}>{option.label}</Text></Pressable>)}</View>
        </>}
        <Text style={[styles.label, { color: c.mutedForeground }]}>Current balance</Text>
        <TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, backgroundColor: c.card, borderColor: c.border }]} />
        <DatePickerField label="Balance as of" value={date} onChange={setDate} placeholder="Choose date" />
        {mode === "reconcile" && <Text style={[styles.help, { color: c.mutedForeground }]}>Enter the balance shown by your bank today. This becomes the trusted starting point for your forecast.</Text>}
        <Pressable disabled={saving} onPress={submit} style={[styles.save, { backgroundColor: c.primary, opacity: saving ? 0.7 : 1 }]}><Text style={[styles.saveText, { color: c.primaryForeground }]}>{saving ? "Saving…" : mode === "reconcile" ? "Confirm Reconciliation" : "Save Account"}</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" }, label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, fontSize: 16 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, type: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 }, typeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  help: { fontSize: 12, lineHeight: 18, marginTop: 10 }, save: { height: 48, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 18 }, saveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});

import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { Account } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export type StatementImportFeedback = { kind: "success" | "error" | "info"; message: string };
type Props = {
  open: boolean;
  accounts: Account[];
  canEdit: boolean;
  busy: boolean;
  feedback: StatementImportFeedback | null;
  onSelect: (accountId: string) => void;
  onCancel: () => void;
};

export function StatementImportPanel({ open, accounts, canEdit, busy, feedback, onSelect, onCancel }: Props) {
  const c = useColors();
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const choices = useMemo(() => {
    const active = accounts.filter(account => account.is_active);
    const counts = new Map<string, number>(), ordinals = new Map<string, number>();
    active.forEach(account => counts.set(account.name.trim().toLowerCase(), (counts.get(account.name.trim().toLowerCase()) ?? 0) + 1));
    return active.map(account => {
      const key = account.name.trim().toLowerCase(), ordinal = (ordinals.get(key) ?? 0) + 1;
      ordinals.set(key, ordinal);
      const type = account.account_type.charAt(0).toUpperCase() + account.account_type.slice(1).replace(/_/g, " ");
      const balance = account.current_balance.toLocaleString("en-US", { style: "currency", currency: "USD" });
      const detail = `${type} · ${balance} balance${(counts.get(key) ?? 0) > 1 ? ` · Account ${ordinal}` : ""}`;
      return { account, detail };
    });
  }, [accounts]);
  const filtered = choices.filter(({ account, detail }) => `${account.name} ${detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (!open && !feedback && canEdit) return null;
  const message = canEdit ? feedback : { kind: "info" as const, message: "Only household editors can import statements." };
  return <View style={[styles.panel, { borderColor: c.border, backgroundColor: c.card }]}>
    {message ? <Text accessibilityRole={message.kind === "error" ? "alert" : undefined} accessibilityLiveRegion="polite" style={[styles.copy, { color: message.kind === "error" ? c.destructive : message.kind === "success" ? c.success : c.mutedForeground }]}>{message.message}</Text> : null}
    {open && canEdit ? <>
      <View style={styles.heading}><Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Choose statement account</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel statement import" disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={[styles.cancelText, { color: c.mutedForeground, opacity: busy ? 0.5 : 1 }]}>Cancel</Text></Pressable></View>
      <Text style={[styles.copy, { color: c.mutedForeground }]}>Choose the account this CSV belongs to. Duplicate rows are checked for that account.</Text>
      <TextInput accessibilityLabel="Search statement accounts" editable={!busy} value={query} onChangeText={setQuery} placeholder="Search account name or type" placeholderTextColor={c.mutedForeground} style={[styles.search, { borderColor: c.border, color: c.foreground, backgroundColor: c.background }]} />
      {busy ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: c.primary }]}>Reading and importing your statement…</Text> : null}
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
        {filtered.map(({ account, detail }) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Import statement to ${account.name}, ${detail}`} disabled={busy} onPress={() => onSelect(account.id)} style={({ pressed }) => [styles.account, { borderColor: c.border, opacity: busy ? 0.5 : pressed ? 0.75 : 1 }]}><Feather name="credit-card" size={18} color={c.primary} /><View style={styles.accountCopy}><Text style={[styles.accountName, { color: c.foreground }]}>{account.name}</Text><Text style={[styles.meta, { color: c.mutedForeground }]}>{detail}</Text></View><Feather name="chevron-right" size={17} color={c.mutedForeground} /></Pressable>)}
        {!filtered.length ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{choices.length ? "No matching accounts. Try another name or type." : "No active accounts are available. Add or reactivate an account first."}</Text> : null}
      </ScrollView>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, marginTop: 12 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 16, lineHeight: 22 },
  copy: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  cancel: { minWidth: 60, minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  search: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 14 },
  list: { maxHeight: 290 }, listContent: { gap: 8 },
  account: { minHeight: 66, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  accountCopy: { flex: 1, minWidth: 0 }, accountName: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
});

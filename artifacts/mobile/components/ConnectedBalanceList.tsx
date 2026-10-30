import { PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React from "react";
import { StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { canonicalConnectedAccounts } from "@/lib/plaidActivity";
import type { ConnectedBankAccount } from "@/lib/financialProjectionTypes";

/** Read-only observations already loaded for the current budget scope. */
export function ConnectedBalanceList({ accounts, ready, timeZone }: { accounts: readonly ConnectedBankAccount[]; ready: boolean; timeZone: string }) {
  const c = useColors();
  const rows = ready ? canonicalConnectedAccounts(accounts.filter(account => account.is_active === true)) : [];
  const updated = (value?: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return "Update time unavailable";
    try { return `Updated ${new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value))}`; } catch { return "Update time unavailable"; }
  };
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <Text style={[styles.title, { color: c.foreground }]}>Recorded connected balances</Text>
    <Text style={[styles.copy, { color: c.mutedForeground }]}>These are recorded observations, not safe-to-spend amounts. Manual accounts are listed separately; their balances are not added here.</Text>
    {!ready ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Connected balance records are loading or unavailable.</Text> : rows.length ? rows.map(account => {
      const known = account.current_balance_available !== false && typeof account.current_balance === "number" && Number.isFinite(account.current_balance);
      const amount = known ? account.current_balance.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "Balance unavailable";
      const type = [account.account_type, account.account_subtype].filter(Boolean).join(" · ") || "Account type unavailable";
      return <View key={account.id} style={[styles.row, { borderColor: c.border }]}>
        <Text style={[styles.name, { color: c.foreground }]}>{account.display_name || account.name || "Unnamed connected account"}</Text>
        <Text style={[styles.amount, { color: c.foreground }]}>{amount}</Text>
        <Text style={[styles.copy, { color: c.mutedForeground }]}>{type}{account.account_type === "credit" ? " · Credit balance, not cash" : ""}</Text>
        <Text style={[styles.copy, { color: c.mutedForeground }]}>{updated(account.updated_at)}</Text>
      </View>;
    }) : <Text style={[styles.copy, { color: c.mutedForeground }]}>No connected balance observations are loaded.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, borderWidth: 1, borderRadius: 16, marginBottom: 16, gap: 8 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  copy: { fontSize: 12, lineHeight: 18 },
  row: { minWidth: 0, paddingTop: 12, marginTop: 4, borderTopWidth: 1, gap: 4 },
  name: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  amount: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold", flexShrink: 1 },
});

import { PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React from "react";
import { StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { canonicalConnectedAccounts } from "@/lib/plaidActivity";
import type { ConnectedBankAccount } from "@/lib/financialProjectionTypes";

/** Read-only observations already loaded for the current budget scope. */
export function ConnectedBalanceList({ accounts, ready, timeZone, presentation = "balances", unavailable = false }: { accounts: readonly ConnectedBankAccount[]; ready: boolean; timeZone: string; presentation?: "balances" | "connections"; unavailable?: boolean }) {
  const c = useColors();
  const rows = ready ? canonicalConnectedAccounts(accounts.filter(account => account.is_active === true)) : [];
  const connections = presentation === "connections";
  const updated = (value?: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return "Update time unavailable";
    try { return `Updated ${new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value))}`; } catch { return "Update time unavailable"; }
  };
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <Text style={[styles.title, { color: c.foreground }]}>{connections ? `Connected accounts${ready ? ` (${rows.length})` : ""}` : "Recorded connected balances"}</Text>
    <Text style={[styles.copy, { color: c.mutedForeground }]}>{connections ? "This household’s linked accounts and last recorded balances." : "These are recorded observations, not safe-to-spend amounts. Manual accounts are listed separately; their balances are not added here."}</Text>
    {!ready ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: c.mutedForeground }]}>{connections ? unavailable ? "Connected accounts are unavailable right now." : "Loading connected accounts…" : "Connected balance records are loading or unavailable."}</Text> : rows.length ? rows.map(account => {
      const known = account.current_balance_available !== false && typeof account.current_balance === "number" && Number.isFinite(account.current_balance);
      const amount = known ? account.current_balance.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "Balance unavailable";
      const type = [account.account_type, account.account_subtype].filter(Boolean).join(" · ") || "Account type unavailable";
      const lastDigits = typeof account.mask === "string" ? account.mask.replace(/\D/g, "").slice(-4) : "";
      return <View key={account.id} style={[styles.row, { borderColor: c.border }]}>
        <Text style={[styles.name, { color: c.foreground }]}>{account.display_name || account.name || "Unnamed connected account"}</Text>
        {connections ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{type}{lastDigits ? ` · •••• ${lastDigits}` : ""}</Text> : null}
        {connections ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Recorded balance</Text> : null}
        <Text style={[styles.amount, { color: c.foreground }]}>{amount}</Text>
        {!connections || account.account_type === "credit" ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{connections ? "Credit balance, not cash" : `${type}${account.account_type === "credit" ? " · Credit balance, not cash" : ""}`}</Text> : null}
        <Text style={[styles.copy, { color: c.mutedForeground }]}>{updated(account.updated_at)}</Text>
      </View>;
    }) : <Text style={[styles.copy, { color: c.mutedForeground }]}>{connections ? "No connected accounts in this household." : "No connected balance observations are loaded."}</Text>}
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

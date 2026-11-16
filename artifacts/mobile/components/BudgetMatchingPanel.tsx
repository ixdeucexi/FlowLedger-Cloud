import React from "react";
import Feather from "@expo/vector-icons/Feather";
import { StyleSheet } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { useColors } from "@/hooks/useColors";
import type { BudgetMatchingTab } from "@/lib/budgetMatching";

type PendingRow = { id: string; name: string; amount: string; date: string; account: string; status?: string; unavailable: boolean };
type Props = {
  tab: BudgetMatchingTab;
  onTabChange: (tab: BudgetMatchingTab) => void;
  pending: PendingRow[];
  postedCount: number;
  ready: boolean;
  canEdit: boolean;
  onOpenPending: (id: string) => void;
  accountPicker: React.ReactNode;
  children: React.ReactNode;
};

/** Local tabs keep the category editor mounted, including unsaved drafts. */
export function BudgetMatchingPanel({ tab, onTabChange, pending, postedCount, ready, canEdit, onOpenPending, accountPicker, children }: Props) {
  const c = useColors();
  return <View style={[styles.panel, { borderColor: c.border, backgroundColor: c.card }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Match bank activity</Text>
    <Text style={[styles.copy, { color: c.mutedForeground }]}>Review activity for this budget month. Pending payments stay outside spending totals until they post.</Text>
    {accountPicker}
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(["pending", "posted"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={`Show ${value} budget activity`} accessibilityState={{ selected: tab === value }} aria-selected={tab === value} onPress={() => onTabChange(value)} style={[styles.tab, { borderColor: c.border, backgroundColor: tab === value ? c.primary : c.muted }]}>
        <Text style={[styles.tabText, { color: tab === value ? c.primaryForeground : c.foreground }]}>{value === "pending" ? "Pending" : "Posted"} ({ready ? value === "pending" ? pending.length : postedCount : "…"})</Text>
      </Pressable>)}
    </View>
    {!ready ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: c.mutedForeground }]}>Loading this household’s activity…</Text> : tab === "posted" ? children : <>
      {!canEdit ? <Text style={[styles.copy, { color: c.mutedForeground }]}>A household editor can match pending payments.</Text> : null}
      {pending.length ? pending.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.status ? "View pending match for" : "Match pending payment"} ${row.name}`} accessibilityState={{ disabled: !canEdit || row.unavailable }} disabled={!canEdit || row.unavailable} onPress={() => onOpenPending(row.id)} style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: !canEdit || row.unavailable ? 0.55 : pressed ? 0.75 : 1 }]}>
        <Feather name="clock" size={19} color={c.warning} />
        <View style={styles.rowCopy}><Text style={[styles.name, { color: c.foreground }]}>{row.name}</Text><Text style={[styles.copy, { color: c.mutedForeground }]}>{row.date} · {row.account}</Text><Text style={[styles.copy, { color: c.warning }]}>{row.status ?? "Pending · not counted yet"}</Text></View>
        <Text style={[styles.amount, { color: c.destructive }]}>{row.amount}</Text><Feather name="chevron-right" size={16} color={c.mutedForeground} />
      </Pressable>) : <Text style={[styles.copy, { color: c.mutedForeground }]}>No pending payments to match for this month and account. Posted activity is available in Posted.</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, marginVertical: 12 },
  title: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  copy: { fontSize: 12, lineHeight: 18 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  tabText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, paddingVertical: 12, minHeight: 68, flexWrap: "wrap" },
  rowCopy: { flex: 1, minWidth: 130, gap: 3 },
  name: { fontSize: 13, fontFamily: "Inter_700Bold" },
  amount: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

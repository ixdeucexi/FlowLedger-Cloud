import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { localDateInTimeZone } from "@/lib/dailyCheckingClose";
import { dateOnlyToLocalDate, MONTH_NAMES } from "@/lib/dateLabels";
import { buildBillPaymentHistory, loadBillPaymentHistoryRows, type BillPaymentHistory, type BillPaymentHistoryEntry, type PaymentHistoryRow } from "@/lib/billPaymentHistory";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
function dateLabel(value: string | null) {
  const parsed = value ? dateOnlyToLocalDate(value) : null;
  return parsed ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Date not recorded";
}
function cycleLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Mounted only after the user opens history; never part of startup loading. */
export function BillPaymentHistoryPanel({ billId, billName }: { billId: string; billName: string }) {
  const c = useColors(), { height } = useWindowDimensions();
  const { user } = useAuth();
  const { activeHousehold, householdTimeZone, demoMode, transactions, overrides } = useBudget();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data?: BillPaymentHistory; error?: string }>({ key: "" });
  const scopeKey = `${user?.id ?? "signed-out"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.role ?? "none"}:${activeHousehold?.isPersonal ?? false}:${billId}:${demoMode}`;
  const [openedScope] = useState(scopeKey);

  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setState({ key: scopeKey });
    if (scopeKey !== openedScope) return () => controller.abort();
    void (async () => {
      try {
        const today = localDateInTimeZone(new Date(), householdTimeZone);
        if (demoMode) {
          const data = buildBillPaymentHistory({ billId, today, transactions: transactions as unknown as PaymentHistoryRow[], overrides: overrides as unknown as PaymentHistoryRow[] });
          if (current) setState({ key: scopeKey, data });
          return;
        }
        if (!user?.id || !activeHousehold) throw new Error("Choose a household and sign in to view payment history.");
        const scope = { ...activeHousehold, userId: user.id };
        const rows = await loadBillPaymentHistoryRows(supabase, { billId, scope, signal: controller.signal });
        const data = buildBillPaymentHistory({ ...rows, billId, today, scope });
        if (current && !controller.signal.aborted) setState({ key: scopeKey, data });
      } catch (error) {
        if (current && !controller.signal.aborted) setState({ key: scopeKey, error: error instanceof Error ? error.message : "Payment history could not be loaded. Please try again." });
      }
    })();
    return () => { current = false; controller.abort(); };
    // Context rows are used only by the demo fixture. Live history is a fresh,
    // explicitly requested read, not a query on every budget-context update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, openedScope, retry, householdTimeZone]);

  // A new scope cannot render the previous scope's data, even before effect cleanup.
  const ready = state.key === scopeKey ? state : { key: scopeKey };
  const data = ready.data;
  if (scopeKey !== openedScope) return <View style={styles.state}><Text style={[styles.stateCopy, { color: c.mutedForeground }]}>Your account or household changed. Close this editor and reopen the bill to view its history.</Text></View>;
  const renderEntry = ({ item }: { item: BillPaymentHistoryEntry }) => (
    <View style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.rowTop}>
        <View style={styles.copy}>
          <Text style={[styles.date, { color: c.foreground }]}>{dateLabel(item.date)}</Text>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>{item.source}</Text>
        </View>
        <Text style={[styles.amount, { color: c.success }]}>{money(item.amount)}</Text>
      </View>
      <Text style={[styles.status, { color: c.mutedForeground }]}>{item.status}</Text>
      {item.kind === "monthly_record" ? <Text style={[styles.detail, { color: c.mutedForeground }]}>{cycleLabel(item.cycle!)} cycle{item.date ? " · recorded payment date" : ""}</Text> : null}
      {item.occurrenceDates.length ? <Text style={[styles.detail, { color: c.mutedForeground }]}>For {item.occurrenceDates.map(dateLabel).join(" · ")}</Text> : null}
    </View>
  );
  return (
    <View style={{ height: Math.min(height * 0.7, 650), flexShrink: 1, minHeight: 0 }}>
      <Text style={[styles.name, { color: c.foreground }]} numberOfLines={2}>{billName}</Text>
      <Text style={[styles.explainer, { color: c.mutedForeground }]}>{demoMode ? "Sample history. " : ""}Recorded payments only. Pending charges and planned payments are not included.</Text>
      {ready.error ? (
        <View style={styles.state} accessibilityRole="alert">
          <Feather name="alert-circle" size={28} color={c.warning} />
          <Text style={[styles.date, { color: c.foreground }]}>Couldn’t load payment history</Text>
          <Text style={[styles.stateCopy, { color: c.mutedForeground }]}>{ready.error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={[styles.retry, { backgroundColor: c.primary }]}>
            <Text style={[styles.date, { color: c.primaryForeground }]}>Try again</Text>
          </Pressable>
        </View>
      ) : !data ? (
        <View style={styles.state} accessibilityLabel="Loading payment history"><ActivityIndicator color={c.primary} /><Text style={[styles.detail, { color: c.mutedForeground }]}>Loading payment history…</Text></View>
      ) : (
        <FlatList data={data.entries} keyExtractor={entry => entry.id} renderItem={renderEntry} showsVerticalScrollIndicator
          style={{ flex: 1, minHeight: 0 }} contentContainerStyle={styles.list} initialNumToRender={12}
          ListHeaderComponent={<View style={styles.summary}>
            <Text style={[styles.detail, { color: c.mutedForeground }]}>{data.paymentCount} recorded payment{data.paymentCount === 1 ? "" : "s"}{data.monthlyRecordCount ? ` · ${data.monthlyRecordCount} monthly record${data.monthlyRecordCount === 1 ? "" : "s"}` : ""} · newest first</Text>
            {data.entries.length > 0 && data.recordedPaidTotal !== null ? <Text style={[styles.total, { color: c.foreground }]}>{money(data.recordedPaidTotal)} <Text style={[styles.detail, { color: c.mutedForeground }]}>recorded paid</Text></Text> : null}
            {data.notices.map(notice => <Text key={notice} style={[styles.notice, { color: c.warning }]}>{notice}</Text>)}
          </View>}
          ListEmptyComponent={<View style={styles.state}>
            <Feather name="clock" size={30} color={c.mutedForeground} />
            <Text style={[styles.date, { color: c.foreground }]}>{data.notices.length ? "No verified payment entries" : "No recorded payments yet"}</Text>
            <Text style={[styles.stateCopy, { color: c.mutedForeground }]}>Record a payment or match it to this bill in Activity. A scheduled payment is not a record of money paid.</Text>
          </View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginBottom: 5 },
  explainer: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular", marginBottom: 14 },
  list: { paddingBottom: 16, gap: 10 },
  summary: { gap: 8, marginBottom: 4 },
  total: { fontSize: 23, fontFamily: "Inter_700Bold" },
  row: { padding: 14, borderWidth: 1, borderRadius: 14, gap: 5 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  date: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  amount: { fontSize: 17, fontFamily: "Inter_700Bold" },
  detail: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  status: { fontSize: 12, fontFamily: "Inter_500Medium" },
  notice: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  state: { alignItems: "center", justifyContent: "center", paddingVertical: 28, paddingHorizontal: 12, gap: 12 },
  stateCopy: { textAlign: "center", fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  retry: { paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12 },
});

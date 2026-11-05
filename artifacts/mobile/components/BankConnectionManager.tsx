import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { confirmAction } from "@/lib/confirmAction";
import { PLAID_CONNECTION_RESULT_EVENT } from "@/lib/plaidOAuth";
import { bankConnectionAccountLabel, bankConnectionConfirmation, bankConnectionSignature, bankConnectionStatusLabel, bankManagementHeaders, parseBankConnections, type ManagedBankConnection } from "@/lib/bankConnectionManagement";

interface ConnectionState {
  scope: string;
  items: ManagedBankConnection[];
  loading: boolean;
  error: string;
  notice: string;
}

export function BankConnectionManager({ ready }: { ready: boolean }) {
  const c = useColors();
  const { user, session, demoMode: authDemoMode } = useAuth();
  const { activeHousehold, canEditHousehold, refreshBankData, householdTimeZone, demoMode: budgetDemoMode } = useBudget();
  const demoMode = Boolean(authDemoMode || budgetDemoMode);
  const scope = JSON.stringify([user?.id, activeHousehold?.householdId, activeHousehold?.budgetId, canEditHousehold, demoMode]);
  const live = useRef({ scope, generation: 0, mounted: true });
  if (live.current.scope !== scope) live.current = { scope, generation: live.current.generation + 1, mounted: true };
  const pending = useRef(false);
  const [state, setState] = useState<ConnectionState>({ scope, items: [], loading: false, error: "", notice: "" });
  const shown = state.scope === scope ? state : { scope, items: [], loading: false, error: "", notice: "" };
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const token = session?.access_token;
  const householdId = activeHousehold?.householdId;

  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; live.current.generation += 1; };
  }, []);

  const load = useCallback(async () => {
    if (!live.current.mounted || live.current.scope !== scope || !ready || demoMode || !canEditHousehold || !user?.id || !token || !householdId || pending.current) return;
    const generation = ++live.current.generation;
    const current = () => live.current.mounted && live.current.scope === scope && live.current.generation === generation;
    pending.current = true;
    setState(previous => ({ scope, items: previous.scope === scope ? previous.items : [], loading: true, error: "", notice: previous.scope === scope ? previous.notice : "" }));
    try {
      const response = await apiFetch("/api/plaid/status", { method: "GET", credentials: "include", headers: bankManagementHeaders(token, householdId) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Could not load bank connection details.");
      const items = parseBankConnections(payload);
      if (current()) setState(previous => ({ scope, items, loading: false, error: "", notice: previous.scope === scope ? previous.notice : "" }));
    } catch (error) {
      if (current()) setState({ scope, items: [], loading: false, notice: "", error: error instanceof Error ? error.message : "Could not load bank connection details." });
    } finally {
      if (current()) pending.current = false;
    }
  }, [canEditHousehold, demoMode, householdId, ready, scope, token, user?.id]);

  useEffect(() => {
    pending.current = false;
    setUnlinking(null);
    setState({ scope, items: [], loading: false, error: "", notice: "" });
    void load();
    return () => { live.current.generation += 1; };
  }, [load, scope]);

  useEffect(() => {
    if (typeof globalThis.addEventListener !== "function") return;
    const reload = () => { void load(); };
    globalThis.addEventListener(PLAID_CONNECTION_RESULT_EVENT, reload);
    return () => globalThis.removeEventListener(PLAID_CONNECTION_RESULT_EVENT, reload);
  }, [load]);

  const requestUnlink = (connection: ManagedBankConnection) => {
    if (!live.current.mounted || live.current.scope !== scope || pending.current || !ready || demoMode || !canEditHousehold || !connection.canDisconnect || !token || !householdId) return;
    const generation = live.current.generation;
    const signature = bankConnectionSignature(connection);
    const current = () => live.current.mounted && live.current.scope === scope && live.current.generation === generation;
    confirmAction({
      title: `Unlink ${connection.name}?`,
      message: bankConnectionConfirmation(connection),
      confirmText: "Unlink bank",
      cancelText: "Keep connected",
      destructive: true,
      onConfirm: async () => {
        if (!current() || pending.current || demoMode || !canEditHousehold) return;
        const latest = shownRef.current.items.find(item => item.id === connection.id);
        if (!latest || bankConnectionSignature(latest) !== signature || !latest.canDisconnect) {
          setState(previous => ({ ...previous, error: "The account list changed. Review the bank details before unlinking." }));
          return;
        }
        pending.current = true;
        setUnlinking(connection.id);
        let removed = false;
        try {
          const response = await apiFetch("/api/plaid/disconnect", { method: "POST", credentials: "include", headers: bankManagementHeaders(token, householdId), body: JSON.stringify({ household_id: householdId, item_id: connection.id }) });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.ok !== true || payload?.status !== "disconnected") throw new Error(payload?.message || "Could not unlink this bank. Try again.");
          removed = true;
          if (!current()) return;
          setState(previous => ({ ...previous, items: previous.items.filter(item => item.id !== connection.id), error: "", notice: `${connection.name} was unlinked. Your saved activity stays in FlowLedger.` }));
          await refreshBankData({ savedOnly: true });
        } catch (error) {
          if (current()) setState(previous => ({ ...previous, error: removed ? "The bank was unlinked, but the saved account list could not refresh. Reload details to check it." : error instanceof Error ? error.message : "Could not unlink this bank. Try again." }));
        } finally {
          if (current()) { pending.current = false; setUnlinking(null); }
        }
      },
    });
  };

  const importingHistory = shown.items.some(item => item.historyStatus === "importing" && !item.cleanupNeeded);
  useEffect(() => {
    if (!ready || demoMode || !canEditHousehold || !importingHistory) return;
    let checks = 0;
    const timer = setInterval(() => {
      checks += 1;
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
      if (checks >= 6) clearInterval(timer);
    }, 10_000);
    return () => clearInterval(timer);
  }, [canEditHousehold, demoMode, importingHistory, load, ready]);

  if (!ready || !user?.id || !householdId) return null;
  const busy = shown.loading || unlinking !== null;
  const lastSync = (value: string | null) => {
    if (!value) return "No successful sync recorded";
    try { return `Last synced ${new Intl.DateTimeFormat(undefined, { timeZone: householdTimeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}`; } catch { return "Sync date unavailable"; }
  };
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <View style={styles.heading}>
      <Text style={[styles.title, { color: c.foreground }]}>Manage bank connections</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reload bank connection details" disabled={busy || demoMode || !canEditHousehold} onPress={() => void load()} style={[styles.reload, { backgroundColor: c.muted, opacity: busy || demoMode || !canEditHousehold ? 0.5 : 1 }]}><Text style={{ color: c.primary }}>Reload details</Text></Pressable>
    </View>
    {demoMode ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Bank connections cannot be changed in the demo.</Text> : !canEditHousehold ? <Text style={[styles.copy, { color: c.mutedForeground }]}>You have view-only access. A household editor can manage their bank connections.</Text> : null}
    {shown.loading ? <ActivityIndicator accessibilityLabel="Loading bank connection details" color={c.primary} /> : null}
    {shown.error ? <Text accessibilityRole="alert" style={[styles.copy, { color: c.destructive }]}>{shown.error}</Text> : null}
    {shown.notice ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: c.success }]}>{shown.notice}</Text> : null}
    {!demoMode && canEditHousehold && !shown.loading && !shown.error && !shown.items.length ? <Text style={[styles.copy, { color: c.mutedForeground }]}>No bank connections are available to manage for this sign-in.</Text> : null}
    {shown.items.map(item => <View key={item.id} style={[styles.item, { borderColor: c.border }]}>
      <Text style={[styles.name, { color: c.foreground }]}>{item.name}</Text>
      <Text style={[styles.copy, { color: c.mutedForeground }]}>{item.cleanupNeeded ? "Unlink incomplete" : bankConnectionStatusLabel(item.status)} · {lastSync(item.lastSuccessfulSync)}</Text>
      {!item.cleanupNeeded && item.historyStatus ? <Text style={[styles.copy, { color: item.historyStatus === "complete" ? c.success : c.mutedForeground }]}>{item.historyStatus === "complete" ? "Recent history imported" : "Importing recent history…"}</Text> : null}
      {item.accounts.map(account => <Text key={account.id} style={[styles.copy, { color: c.foreground }]}>{bankConnectionAccountLabel(account)}{account.type ? ` · ${account.type}` : ""}</Text>)}
      {!item.accounts.length ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Account details are not available yet.</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.cleanupNeeded ? "Retry unlink" : "Unlink"} ${item.name}`} disabled={busy || !canEditHousehold || !item.canDisconnect} onPress={() => requestUnlink(item)} style={[styles.unlink, { borderColor: c.destructive + "50", opacity: busy || !canEditHousehold || !item.canDisconnect ? 0.45 : 1 }]}><Text style={{ color: c.destructive }}>{unlinking === item.id ? "Unlinking…" : item.cleanupNeeded ? "Retry unlink" : "Unlink bank"}</Text></Pressable>
      {!canEditHousehold || !item.canDisconnect ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Only an authorized editor who owns this connection can unlink it.</Text> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, borderWidth: 1, borderRadius: 16, marginBottom: 16, gap: 12 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", flexShrink: 1 },
  name: { fontSize: 15, fontFamily: "Inter_700Bold" },
  copy: { fontSize: 12, lineHeight: 18 },
  item: { borderTopWidth: 1, paddingTop: 14, gap: 7 },
  reload: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  unlink: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, alignSelf: "flex-start" },
});

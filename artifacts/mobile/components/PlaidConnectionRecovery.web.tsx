import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { confirmAction } from "@/lib/confirmAction";
import {
  clearPlaidAccountsPending, discardPendingPlaidAttempt, matchesStoredPlaidSession,
  notifyPlaidConnectionState, plaidCompletionInFlight,
  PLAID_CONNECTION_RESULT_EVENT, PLAID_CONNECTION_STATE_EVENT, PLAID_RESUME_CONNECTION_EVENT,
  readPendingPlaidOAuthSession, readPlaidAccountsPending, savedPlaidAccountsAvailability, type PlaidOAuthSession, type SavedPlaidAccountsPending,
} from "@/lib/plaidOAuth";

type RecoveryState = { scope: string; attempt: PlaidOAuthSession | null; saved: SavedPlaidAccountsPending | null; busy: boolean; message: string };

/** Recovery for this browser's unfinished sign-in, separate from saved bank/account management. */
export function PlaidConnectionRecovery() {
  const c = useColors();
  const { user, session, demoMode: authDemoMode } = useAuth();
  const { activeHousehold, demoMode: budgetDemoMode, refreshBankData } = useBudget();
  const demoMode = Boolean(authDemoMode || budgetDemoMode);
  const userId = user?.id || "";
  const householdId = activeHousehold?.householdId || "";
  const scope = JSON.stringify([userId, householdId, demoMode]);
  const live = useRef({ scope, generation: 0, mounted: true });
  if (live.current.scope !== scope) live.current = { scope, generation: live.current.generation + 1, mounted: true };
  const [state, setState] = useState<RecoveryState>({ scope, attempt: null, saved: null, busy: false, message: "" });
  const generation = live.current.generation;
  const current = useCallback(() => live.current.mounted && live.current.scope === scope && live.current.generation === generation && !demoMode, [demoMode, generation, scope]);
  const read = useCallback(() => {
    if (!current() || !userId || !householdId) return;
    try {
      const pending = readPendingPlaidOAuthSession(window.localStorage, userId);
      const attempt = pending?.hostedSession && pending.householdId === householdId ? pending : null;
      const saved = readPlaidAccountsPending(window.localStorage, { userId, householdId });
      setState(previous => ({ scope, attempt, saved, busy: Boolean(attempt && plaidCompletionInFlight(attempt)), message: previous.scope === scope ? previous.message : "" }));
    } catch { /* Browser recovery does not affect saved financial records. */ }
  }, [current, householdId, scope, userId]);

  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; live.current.generation += 1; };
  }, []);
  useEffect(() => {
    read();
    const events = ["focus", "storage", PLAID_CONNECTION_RESULT_EVENT, PLAID_CONNECTION_STATE_EVENT];
    events.forEach(event => window.addEventListener(event, read));
    return () => events.forEach(event => window.removeEventListener(event, read));
  }, [read]);

  const shown = state.scope === scope ? state : null;
  const startOver = () => {
    const attempt = shown?.attempt;
    if (!current() || !attempt || plaidCompletionInFlight(attempt)) return;
    confirmAction({
      title: "Start this connection over?",
      message: "Clear this unfinished sign-in from this browser? Your saved bank connections, accounts, and activity will stay. You can then choose Connect account to start again.",
      confirmText: "Start over",
      cancelText: "Keep connection",
      onConfirm: () => {
        if (!current() || !matchesStoredPlaidSession(window.localStorage, attempt) || plaidCompletionInFlight(attempt)) return;
        if (!discardPendingPlaidAttempt(window.localStorage, attempt)) return;
        setState({ scope, attempt: null, saved: shown?.saved || null, busy: false, message: "Unfinished sign-in cleared. Choose Connect account when you are ready." });
        // Stop a retained resume view without creating a new Link token.
        window.dispatchEvent(new Event(PLAID_RESUME_CONNECTION_EVENT));
      },
    });
  };

  const checkAccounts = async () => {
    const saved = shown?.saved;
    if (!current() || !saved || shown?.busy || !session?.access_token) return;
    setState(previous => ({ ...previous, busy: true, message: "" }));
    try {
      const response = await apiFetch("/api/plaid/status", { credentials: "include", headers: { Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId } });
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      const latest = readPlaidAccountsPending(window.localStorage, { userId, householdId });
      if (!latest || JSON.stringify(latest) !== JSON.stringify(saved)) { read(); return; }
      if (!response.ok) throw new Error("Could not check saved accounts. Try again.");
      const availability = savedPlaidAccountsAvailability(payload, saved);
      if (availability === "unavailable") {
        if (!clearPlaidAccountsPending(window.localStorage, saved)) { read(); return; }
        notifyPlaidConnectionState();
        setState(previous => ({ ...previous, saved: null, busy: false, message: "This connection is not available. Check Bank connections for its current status." }));
      } else if (availability === "ready") {
        await refreshBankData({ savedOnly: true });
        if (!current()) return;
        const latestAfterRefresh = readPlaidAccountsPending(window.localStorage, { userId, householdId });
        if (!latestAfterRefresh || JSON.stringify(latestAfterRefresh) !== JSON.stringify(saved)) { read(); return; }
        if (!clearPlaidAccountsPending(window.localStorage, saved)) { read(); return; }
        notifyPlaidConnectionState();
        setState(previous => ({ ...previous, saved: null, busy: false, message: "Your saved accounts are ready." }));
      } else setState(previous => ({ ...previous, busy: false, message: "Accounts are not available yet. Check Bank connections for the latest status." }));
    } catch (error) {
      if (current()) {
        const latest = readPlaidAccountsPending(window.localStorage, { userId, householdId });
        if (!latest || JSON.stringify(latest) !== JSON.stringify(saved)) { read(); return; }
        setState(previous => ({ ...previous, busy: false, message: error instanceof Error ? error.message : "Could not check saved accounts." }));
      }
    }
  };

  if (demoMode || !userId || !householdId || !shown || (!shown.attempt && !shown.saved && !shown.message)) return null;
  return <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
    <Text style={[styles.title, { color: c.foreground }]}>{shown.attempt ? shown.busy ? "Checking your connection" : "Connection not finished" : shown.saved ? "Waiting for bank accounts" : "Connection update"}</Text>
    <Text style={[styles.copy, { color: c.mutedForeground }]}>{shown.attempt ? "Your sign-in is saved in this browser. Continue to check the same connection." : shown.saved ? "Your bank connection was saved. Accounts are not available yet. Check Bank connections for the latest status." : shown.message}</Text>
    {shown.message && (shown.attempt || shown.saved) ? <Text style={[styles.copy, { color: c.mutedForeground }]}>{shown.message}</Text> : null}
    <View style={styles.actions}>
      {shown.attempt ? <>
        <Pressable accessibilityRole="button" disabled={shown.busy} onPress={() => { if (current() && shown.attempt && matchesStoredPlaidSession(window.localStorage, shown.attempt)) window.dispatchEvent(new Event(PLAID_RESUME_CONNECTION_EVENT)); }} style={[styles.button, { borderColor: c.primary, opacity: shown.busy ? 0.5 : 1 }]}><Text style={[styles.label, { color: c.primary }]}>Continue connection</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={shown.busy} onPress={startOver} style={[styles.button, { borderColor: c.border, opacity: shown.busy ? 0.5 : 1 }]}><Text style={[styles.label, { color: c.mutedForeground }]}>Start over</Text></Pressable>
      </> : shown.saved ? <Pressable accessibilityRole="button" disabled={shown.busy} onPress={() => void checkAccounts()} style={[styles.button, { borderColor: c.primary }]}><Text style={[styles.label, { color: c.primary }]}>{shown.busy ? "Checking accounts…" : "Check accounts"}</Text></Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 9 },
  title: { fontSize: 16, fontWeight: "700" },
  copy: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "700" },
});

import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
"use client";

import Feather from "@expo/vector-icons/Feather";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import { usePlaidLink } from "react-plaid-link";

import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  clearPlaidOAuthSession,
  PLAID_ACCOUNTS_PENDING_MESSAGE,
  PLAID_CONNECTION_STATE_EVENT,
  savePlaidAccountsPending,
  verifiedPlaidConnection,
  matchesStoredPlaidSession,
  notifyPlaidConnectionState,
  readPlaidOAuthAttempt,
  PLAID_CONNECTION_RESULT_EVENT,
  PLAID_RESUME_CONNECTION_EVENT,
  markPlaidOAuthAwaitingReturn,
  readPendingPlaidOAuthSession,
  savePlaidOAuthSession,
  takePlaidConnectionResult,
} from "@/lib/plaidOAuth";

type Colors = {
  primary: string;
  primaryForeground: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  success: string;
  warning: string;
  border: string;
};

type Props = { colors: Colors; onConnected?: () => void };
type LinkIntent = "bank" | "credit_card";
type ActiveAction = LinkIntent | "sync" | `attach:${string}` | null;

type Status = {
  items?: Array<{ institution_name?: string | null; status?: string | null; error_code?: string | null }>;
  debt_options?: Array<{ id: string; name: string }>;
  accounts?: Array<{
    id: string;
    name?: string | null;
    mask?: string | null;
    account_type?: string | null;
    current_balance?: number | null;
    minimum_payment_amount?: number | null;
    next_payment_due_date?: string | null;
    linked_debt_id?: string | null;
    linked_debt_name?: string | null;
    include_in_snowball?: boolean;
  }>;
};

function dollars(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "Balance unavailable";
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function getFreshSession() {
  const current = await supabase.auth.getSession();
  if (current.error || !current.data.session) return null;

  // Avoid using a token captured during a previous render. Refresh only when
  // the current session is close to expiry so ordinary status checks stay fast.
  const expiresAt = (current.data.session.expires_at || 0) * 1000;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.data.session && !refreshed.error) return refreshed.data.session;
  }
  return current.data.session;
}

export function PlaidLinkButton({ colors, onConnected }: Props) {
  const { demoMode: authDemoMode } = useAuth();
  const { demoMode: budgetDemoMode } = useBudget();
  if (authDemoMode || budgetDemoMode) return null;
  return <ActivePlaidLinkButton colors={colors} onConnected={onConnected} />;
}

function ActivePlaidLinkButton({ colors, onConnected }: Props) {
  const { user, demoMode: authDemoMode } = useAuth();
  const { activeHousehold, demoMode: budgetDemoMode } = useBudget();
  const demoMode = authDemoMode || budgetDemoMode;
  const householdId = activeHousehold?.householdId ?? "";
  const userId = user?.id ?? "";
  const scopeKey = `${userId}:${householdId}:${demoMode ? "demo" : "real"}`;
  const liveScope = useRef({ key: scopeKey, mounted: true, demoMode });
  liveScope.current.key = scopeKey;
  liveScope.current.demoMode = demoMode;
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({});
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState(false);
  const opened = useRef(false);
  const linkUserId = useRef<string | null>(null);
  const busy = activeAction !== null;
  const isCurrentScope = useCallback(() => liveScope.current.mounted && !liveScope.current.demoMode && liveScope.current.key === scopeKey, [scopeKey]);

  useEffect(() => {
    liveScope.current.mounted = true;
    return () => { liveScope.current.mounted = false; };
  }, []);

  const loadStatus = useCallback(async () => {
    if (!isCurrentScope()) return;
    const session = await getFreshSession();
    if (!session || session.user.id !== userId || !isCurrentScope()) return;
    try {
      const response = await apiFetch("/api/plaid/status", {
        credentials: "include",
        headers: { Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId },
      });
      if (response.ok) {
        const result = await response.json() as Status;
        if (isCurrentScope()) setStatus(result);
      }
    } catch {
      // Status is informational; the connect action reports actionable errors.
    }
  }, [householdId, isCurrentScope, userId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const finish = useCallback((text: string) => {
    setLinkToken(null);
    setActiveAction(null);
    opened.current = false;
    linkUserId.current = null;
    setMessage(text);
  }, []);

  useEffect(() => {
    setStatus({});
    setMessage(null);
    setPendingConnection(false);
    setLinkToken(null);
    setActiveAction(null);
    opened.current = false;
    linkUserId.current = null;
    const consumeResult = () => {
      if (typeof window === "undefined" || !userId || !householdId || !isCurrentScope()) return;
      try {
        const pending = readPendingPlaidOAuthSession(window.localStorage, userId);
        setPendingConnection(Boolean(pending?.hostedSession && pending.householdId === householdId));
        const result = takePlaidConnectionResult(window.localStorage, Date.now(), { userId, householdId });
        if (result) {
          finish(result);
          void loadStatus();
        }
      } catch { /* The connected-account list still reads saved bank data. */ }
    };
    consumeResult();
    window.addEventListener(PLAID_CONNECTION_RESULT_EVENT, consumeResult);
    window.addEventListener(PLAID_CONNECTION_STATE_EVENT, consumeResult);
    window.addEventListener("focus", consumeResult);
    return () => {
      window.removeEventListener(PLAID_CONNECTION_RESULT_EVENT, consumeResult);
      window.removeEventListener(PLAID_CONNECTION_STATE_EVENT, consumeResult);
      window.removeEventListener("focus", consumeResult);
    };
  }, [finish, householdId, isCurrentScope, loadStatus, userId]);

  const onSuccess = useCallback(async (publicToken: string) => {
    if (!isCurrentScope()) return;
    try {
      const attempt = readPlaidOAuthAttempt(window.localStorage, userId);
      if (attempt && (attempt.householdId !== householdId || attempt.linkToken !== linkToken)) return;
      const session = await getFreshSession();
      if (!isCurrentScope()) return;
      if (!session) return finish("Please sign in again before finishing the connection.");
      const response = await apiFetch("/api/plaid/exchange-public-token", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          "X-FlowLedger-Household-Id": householdId,
        },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const result = await response.json().catch(() => ({}));
      if (!isCurrentScope() || (attempt && !matchesStoredPlaidSession(window.localStorage, attempt))) return;
      if (!response.ok) throw new Error(result.message || "Could not finish connecting this bank.");
      const verified = verifiedPlaidConnection(result);
      if (typeof window !== "undefined") {
        if (verified.status === "accounts_pending") savePlaidAccountsPending(window.localStorage, { userId, householdId }, verified);
        if (attempt) clearPlaidOAuthSession(window.localStorage, attempt);
        notifyPlaidConnectionState();
      }
      finish(verified.status === "accounts_pending" ? PLAID_ACCOUNTS_PENDING_MESSAGE : result.already_connected
        ? "That account is already connected. FlowLedger kept the existing secure connection."
        : result.credit_card_debts_count > 0
          ? `${result.credit_card_debts_count} credit card${result.credit_card_debts_count === 1 ? "" : "s"} added to Debt and Snowball with live balances.`
          : result.credit_cards_count > 0
            ? "Credit card connected. Attach it to Debt and Snowball below."
            : "Account connected. Recent activity is syncing now.");
      onConnected?.();
      await loadStatus();
    } catch (error) {
      if (isCurrentScope()) finish(error instanceof Error ? error.message : "Could not finish connecting this bank.");
    }
  }, [finish, householdId, isCurrentScope, linkToken, loadStatus, onConnected, userId]);

  const onExit = useCallback(() => {
    if (!isCurrentScope()) return;
    if (typeof window !== "undefined") clearPlaidOAuthSession(window.localStorage);
    finish("Bank connection canceled. You can try again whenever you are ready.");
  }, [finish, isCurrentScope]);
  const onEvent = useCallback((eventName: string) => {
    if (!isCurrentScope() || eventName !== "OPEN_OAUTH" || typeof window === "undefined" || !linkUserId.current) return;
    markPlaidOAuthAwaitingReturn(window.localStorage, linkUserId.current);
  }, [isCurrentScope]);
  const { ready, error, open } = usePlaidLink({ token: demoMode ? null : linkToken, onSuccess, onExit, onEvent });

  useEffect(() => {
    if (!isCurrentScope() || !linkToken || !ready || opened.current) return;
    opened.current = true;
    open();
  }, [isCurrentScope, linkToken, ready, open]);

  useEffect(() => {
    if (!isCurrentScope() || !linkToken || !error) return;
    if (typeof window !== "undefined") clearPlaidOAuthSession(window.localStorage);
    finish("Plaid could not open this connection. Please try again.");
  }, [error, finish, isCurrentScope, linkToken]);

  const connect = useCallback(async (intent: LinkIntent) => {
    if (!isCurrentScope() || busy || linkToken) return;
    if (pendingConnection) {
      window.dispatchEvent(new Event(PLAID_RESUME_CONNECTION_EVENT));
      return;
    }
    setActiveAction(intent);
    setMessage(null);
    opened.current = false;
    const session = await getFreshSession();
    if (!isCurrentScope()) return;
    if (!session) {
      setActiveAction(null);
      setMessage("Please sign in again before connecting a bank.");
      return;
    }
    try {
      const response = await apiFetch("/api/plaid/create-link-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId },
        body: JSON.stringify({ intent, platform: "web" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!isCurrentScope()) return;
      if (!response.ok || !result.link_token) throw new Error(result.message || "Could not start secure bank linking.");
      if (typeof window !== "undefined") {
        savePlaidOAuthSession(window.localStorage, {
          linkToken: result.link_token,
          hostedSession: typeof result.hosted_session === "string" ? result.hosted_session : undefined,
          intent,
          householdId,
          userId: session.user.id,
          createdAt: Date.now(),
          awaitingReturn: Boolean(result.hosted_link_url),
        });
        linkUserId.current = session.user.id;
        if (result.hosted_link_url && result.hosted_session) {
          window.location.assign(result.hosted_link_url);
          return;
        }
      }
      setLinkToken(result.link_token);
    } catch (error) {
      if (isCurrentScope()) {
        setActiveAction(null);
        setMessage(error instanceof Error ? error.message : "Could not start secure bank linking.");
      }
    }
  }, [busy, householdId, isCurrentScope, linkToken, pendingConnection]);

  const attachCard = useCallback(async (accountRecordId: string, debtId?: string) => {
    if (!isCurrentScope() || busy) return;
    setActiveAction(`attach:${accountRecordId}`);
    setMessage(null);
    try {
      const session = await getFreshSession();
      if (!isCurrentScope()) return;
      if (!session) throw new Error("Please sign in again before attaching this card.");
      const response = await apiFetch("/api/plaid/attach-credit-card", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          "X-FlowLedger-Household-Id": householdId,
        },
        body: JSON.stringify({ plaid_account_record_id: accountRecordId, debt_id: debtId || undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!isCurrentScope()) return;
      if (!response.ok) throw new Error(result.message || "Could not add this card to Debt and Snowball.");
      setMessage(`${result.debt_name || "Credit card"} is now included in Debt and Snowball.`);
      await loadStatus();
      onConnected?.();
    } catch (error) {
      if (isCurrentScope()) setMessage(error instanceof Error ? error.message : "Could not add this card to Debt and Snowball.");
    } finally {
      if (isCurrentScope()) setActiveAction(null);
    }
  }, [busy, householdId, isCurrentScope, loadStatus, onConnected]);

  const sync = useCallback(async () => {
    if (!isCurrentScope() || busy) return;
    setActiveAction("sync");
    setMessage(null);
    try {
      const session = await getFreshSession();
      if (!isCurrentScope()) return;
      if (!session) throw new Error("Please sign in again before syncing your bank.");
      const response = await apiFetch("/api/plaid/sync", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId } });
      const result = await response.json().catch(() => ({}));
      if (!isCurrentScope()) return;
      if (!response.ok) throw new Error(result.message || "Could not sync bank activity.");
      setMessage("Bank activity is up to date.");
      onConnected?.();
      void loadStatus();
    } catch (error) {
      if (isCurrentScope()) setMessage(error instanceof Error ? error.message : "Could not sync bank activity.");
    } finally { if (isCurrentScope()) setActiveAction(null); }
  }, [busy, householdId, isCurrentScope, loadStatus, onConnected]);

  if (demoMode) return null;
  const item = status.items?.[0];
  const connected = Boolean(item);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: `${colors.success}22` }]}><Feather name="link" size={20} color={colors.success} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{connected ? (item?.institution_name || "Bank connected") : "Connect your bank"}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{connected ? `${status.accounts?.length || 0} account${status.accounts?.length === 1 ? "" : "s"} linked` : "Connect balances and checking activity securely through Plaid."}</Text>
        </View>
        {connected && <View style={[styles.status, { backgroundColor: `${colors.success}22` }]}><Text style={[styles.statusText, { color: colors.success }]}>Connected</Text></View>}
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Plaid keeps credentials with your bank. FlowLedger imports checking activity; credit-card purchases stay out of Activity and Forecast.</Text>
      {(status.accounts || []).filter(account => account.account_type === "credit").map((account, index) => {
        const attached = Boolean(account.linked_debt_id && account.include_in_snowball);
        const attaching = activeAction === `attach:${account.id}`;
        return (
          <View key={account.id || `${account.name || "card"}-${account.mask || index}`} style={[styles.cardAccount, { borderColor: colors.border }]}>
            <View style={styles.cardAccountTop}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardAccountName, { color: colors.foreground }]}>{account.name || "Credit card"}{account.mask ? ` •••• ${account.mask}` : ""}</Text>
                <Text style={[styles.cardAccountMeta, { color: colors.mutedForeground }]}>Minimum {account.minimum_payment_amount == null ? "pending bank update" : dollars(account.minimum_payment_amount)}{account.next_payment_due_date ? ` · due ${account.next_payment_due_date}` : ""}</Text>
              </View>
              <Text style={[styles.cardAccountBalance, { color: colors.foreground }]}>{dollars(account.current_balance)}</Text>
            </View>
            {attached ? (
              <View style={[styles.debtStatus, { backgroundColor: `${colors.success}18`, borderColor: `${colors.success}33` }]}>
                <Feather name="check-circle" size={14} color={colors.success} />
                <Text style={[styles.debtStatusText, { color: colors.success }]}>{account.linked_debt_name || "Card"} is in Debt and Snowball</Text>
              </View>
            ) : (
              <View style={styles.attachChoices}>
                {(status.debt_options || []).length > 0 ? (
                  <>
                    <Text style={[styles.attachLabel, { color: colors.mutedForeground }]}>Attach to an existing debt</Text>
                    <View style={styles.debtOptions}>
                      {(status.debt_options || []).map(debt => (
                        <Pressable
                          key={debt.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Attach card to ${debt.name} and include it in Snowball`}
                          disabled={busy}
                          onPress={() => void attachCard(account.id, debt.id)}
                          style={({ pressed }) => [styles.debtOption, { borderColor: colors.border, opacity: pressed || busy ? 0.7 : 1 }]}
                        >
                          {attaching ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="link-2" size={14} color={colors.primary} />}
                          <Text style={[styles.debtOptionText, { color: colors.foreground }]}>{debt.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Create a Debt and Snowball account for ${account.name || "credit card"}`}
                  disabled={busy}
                  onPress={() => void attachCard(account.id)}
                  style={({ pressed }) => [styles.attachButton, { borderColor: `${colors.primary}55`, backgroundColor: `${colors.primary}12`, opacity: pressed || busy ? 0.7 : 1 }]}
                >
                  {attaching ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="plus-circle" size={15} color={colors.primary} />}
                  <Text style={[styles.attachButtonText, { color: colors.primary }]}>Create new Debt &amp; Snowball account</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {connected && <Text style={[styles.note, { color: colors.mutedForeground }]}>Connected credit cards update Debt and Snowball. Card purchases are not imported into FlowLedger Activity or Forecast.</Text>}
      <View style={styles.connectHeading}>
        <Text style={[styles.connectTitle, { color: colors.foreground }]}>Add a new connection</Text>
        <Text style={[styles.connectCopy, { color: colors.mutedForeground }]}>Choose what you want Plaid to connect. This does not replace or merely refresh your existing accounts.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pendingConnection ? "Continue connection" : "Connect a bank account or credit card through Plaid"}
          disabled={busy}
          onPress={() => void connect("bank")}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 }]}
        >
          {activeAction === "bank" ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="plus-circle" size={16} color={colors.primaryForeground} />}
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{pendingConnection ? "Continue connection" : "Connect account"}</Text>
        </Pressable>
        {connected && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void sync()}
            style={({ pressed }) => [styles.syncButton, { borderColor: colors.border, opacity: pressed || busy ? 0.7 : 1 }]}
          >
            {activeAction === "sync"
              ? <ActivityIndicator size="small" color={colors.mutedForeground} />
              : <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />}
            <Text style={[styles.syncText, { color: colors.mutedForeground }]}>Sync accounts</Text>
          </Pressable>
        )}
      </View>
      {(message || error) && <Text style={[styles.message, { color: error ? colors.warning : colors.mutedForeground }]}>{error ? "Plaid could not open. Please try again." : message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 3 },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: "700" },
  note: { fontSize: 13, lineHeight: 19 },
  cardAccount: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 10 },
  cardAccountTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardAccountName: { fontSize: 14, fontWeight: "700" },
  cardAccountMeta: { fontSize: 12, marginTop: 3 },
  cardAccountBalance: { fontSize: 14, fontWeight: "800" },
  debtStatus: { minHeight: 36, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 7 },
  debtStatusText: { fontSize: 12, fontWeight: "700" },
  attachChoices: { gap: 8 },
  attachLabel: { fontSize: 11, fontWeight: "700" },
  debtOptions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  debtOption: { minHeight: 36, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  debtOptionText: { fontSize: 12, fontWeight: "700" },
  attachButton: { minHeight: 40, borderRadius: 10, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  attachButtonText: { fontSize: 13, fontWeight: "800" },
  connectHeading: { gap: 4 },
  connectTitle: { fontSize: 14, fontWeight: "800" },
  connectCopy: { fontSize: 12, lineHeight: 18 },
  actions: { gap: 10 },
  button: { minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  syncButton: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  syncText: { fontSize: 13, fontWeight: "700" },
  message: { fontSize: 13, lineHeight: 19 },
});

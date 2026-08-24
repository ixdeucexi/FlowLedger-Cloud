import { Feather } from "@expo/vector-icons";
import { createPlaidLinkSession, type LinkExit, type LinkSuccess } from "react-native-plaid-link-sdk";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

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
type PlaidItem = { id: string; institution_name?: string | null; status?: string | null; error_code?: string | null };
type PlaidAccount = { id: string; plaid_item_record_id?: string | null; name?: string | null; display_name?: string | null; mask?: string | null; account_type?: string | null; account_subtype?: string | null };
type Status = { items?: PlaidItem[]; accounts?: PlaidAccount[] };

async function sessionHeaders(householdId: string, json = false): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Please sign in again before managing bank connections.");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    "X-FlowLedger-Household-Id": householdId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function responseJson(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : fallback);
  return result;
}

function confirmDisconnect(name: string): Promise<boolean> {
  return new Promise(resolve => Alert.alert(
    `Disconnect ${name}?`,
    "Future bank updates will stop. Existing imported activity stays in FlowLedger for your records.",
    [
      { text: "Keep connected", style: "cancel", onPress: () => resolve(false) },
      { text: "Disconnect", style: "destructive", onPress: () => resolve(true) },
    ],
    { cancelable: true, onDismiss: () => resolve(false) },
  ));
}

export function PlaidLinkButton({ colors, onConnected }: Props) {
  const { activeHousehold, updateConnectedBankAccountDisplayName } = useBudget();
  const householdId = activeHousehold?.householdId ?? "";
  const [status, setStatus] = useState<Status>({});
  const [statusState, setStatusState] = useState<"loading" | "ready" | "error">("loading");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const busy = activeAction !== null;

  const loadStatus = useCallback(async () => {
    if (!householdId) return;
    setStatusState(previous => previous === "ready" ? "ready" : "loading");
    setStatusError(null);
    try {
      const response = await apiFetch("/api/plaid/status", { headers: await sessionHeaders(householdId) });
      const result = await responseJson(response, "Could not load bank connections.");
      setStatus(result as Status);
      setStatusState("ready");
    } catch (error) {
      setStatusState("error");
      setStatusError(error instanceof Error ? error.message : "Could not load bank connections.");
    }
  }, [householdId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const sync = useCallback(async (successMessage = "Bank activity is up to date.") => {
    const response = await apiFetch("/api/plaid/sync", { method: "POST", headers: await sessionHeaders(householdId) });
    await responseJson(response, "Could not refresh bank activity.");
    setMessage(successMessage);
    await loadStatus();
    onConnected?.();
  }, [householdId, loadStatus, onConnected]);

  const completeNewConnection = useCallback(async (success: LinkSuccess) => {
    const response = await apiFetch("/api/plaid/exchange-public-token", {
      method: "POST",
      headers: await sessionHeaders(householdId, true),
      body: JSON.stringify({ public_token: success.publicToken }),
    });
    const result = await responseJson(response, "Could not finish connecting this bank.");
    const creditCount = Number(result.credit_card_debts_count || result.credit_cards_count || 0);
    setMessage(creditCount > 0
      ? `${creditCount} credit card${creditCount === 1 ? "" : "s"} connected. Card purchases stay out of Activity and Forecast.`
      : result.already_connected ? "That account was already connected." : "Account connected. Recent activity is syncing now.");
    await loadStatus();
    onConnected?.();
  }, [householdId, loadStatus, onConnected]);

  const openLink = useCallback(async (mode: "create" | "update", itemId?: string) => {
    if (busy || !householdId || statusState !== "ready") return;
    const action = mode === "update" ? `reconnect:${itemId}` : "connect";
    setActiveAction(action);
    setMessage(null);
    try {
      const response = await apiFetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: await sessionHeaders(householdId, true),
        body: JSON.stringify({ intent: "bank", platform: Platform.OS, mode, item_id: itemId }),
      });
      const result = await responseJson(response, mode === "update" ? "Could not start bank reconnection." : "Could not start secure bank linking.");
      if (typeof result.link_token !== "string") throw new Error("Plaid did not return a secure native link token.");
      const linkSession = await createPlaidLinkSession({
        token: result.link_token,
        onSuccess: success => {
          void (async () => {
            try {
              if (mode === "update") await sync("Bank connection restored and refreshed.");
              else await completeNewConnection(success);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not finish the bank connection.");
            } finally { setActiveAction(null); }
          })();
        },
        onExit: (exit: LinkExit) => {
          setActiveAction(null);
          setMessage(exit.error ? "Plaid could not complete this connection. Review the bank details and try again." : "Bank connection canceled. Nothing was changed.");
        },
        onEvent: () => undefined,
      });
      await linkSession.open(true);
    } catch (error) {
      setActiveAction(null);
      setMessage(error instanceof Error ? error.message : "Plaid could not open. Please try again.");
    }
  }, [busy, completeNewConnection, householdId, statusState, sync]);

  const disconnect = useCallback(async (item: PlaidItem) => {
    if (busy || !await confirmDisconnect(item.institution_name || "this bank")) return;
    setActiveAction(`disconnect:${item.id}`);
    setMessage(null);
    try {
      const response = await apiFetch("/api/plaid/disconnect", {
        method: "POST",
        headers: await sessionHeaders(householdId, true),
        body: JSON.stringify({ item_id: item.id }),
      });
      await responseJson(response, "Could not disconnect this bank.");
      setMessage(`${item.institution_name || "Bank"} was disconnected.`);
      await loadStatus();
      onConnected?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect this bank.");
    } finally { setActiveAction(null); }
  }, [busy, householdId, loadStatus, onConnected]);

  const saveNickname = useCallback(async (account: PlaidAccount) => {
    if (busy) return;
    setActiveAction(`rename:${account.id}`);
    setMessage(null);
    try {
      await updateConnectedBankAccountDisplayName(account.id, nickname);
      setEditingAccountId(null);
      setMessage("Account name updated.");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the account name.");
    } finally { setActiveAction(null); }
  }, [busy, loadStatus, nickname, updateConnectedBankAccountDisplayName]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: `${colors.success}22` }]}><Feather name="link" size={20} color={colors.success} /></View>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.foreground }]}>Bank connections</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Checking, savings, and credit through Plaid</Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Plaid keeps credentials with your bank. Credit-card purchases are excluded from Activity and Forecast; card balances can still support Debt and Snowball.</Text>

      {statusState === "loading" ? (
        <View style={styles.statusNotice}><ActivityIndicator color={colors.primary} /><Text style={[styles.message, { color: colors.mutedForeground }]}>Loading bank connections…</Text></View>
      ) : null}
      {statusState === "error" ? (
        <View style={[styles.statusError, { borderColor: colors.warning }]}>
          <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.warning }]}>{statusError || "Could not load bank connections."}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadStatus()} style={[styles.smallButton, { borderColor: colors.warning }]}>
            <Text style={[styles.smallButtonText, { color: colors.warning }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {statusState === "ready" ? (status.items || []).map(item => (
        <View key={item.id} style={[styles.item, { borderColor: colors.border }]}>
          <View style={styles.flex}>
            <Text style={[styles.itemName, { color: colors.foreground }]}>{item.institution_name || "Connected institution"}</Text>
            <Text style={[styles.itemStatus, { color: item.error_code ? colors.warning : colors.success }]}>{item.error_code ? "Needs reconnection" : "Connected"}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openLink("update", item.id)} style={[styles.smallButton, { borderColor: colors.border }]}>
            {activeAction === `reconnect:${item.id}` ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.smallButtonText, { color: colors.primary }]}>Reconnect</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void disconnect(item)} style={[styles.smallButton, { borderColor: `${colors.warning}66` }]}>
            {activeAction === `disconnect:${item.id}` ? <ActivityIndicator color={colors.warning} /> : <Text style={[styles.smallButtonText, { color: colors.warning }]}>Disconnect</Text>}
          </Pressable>
        </View>
      )) : null}

      {statusState === "ready" ? (status.accounts || []).filter(account => ["checking", "savings"].includes(String(account.account_subtype || "").toLowerCase())).map(account => (
        <View key={account.id} style={[styles.account, { borderColor: colors.border }]}>
          {editingAccountId === account.id ? (
            <>
              <TextInput accessibilityLabel={`Name for ${account.name || "savings account"}`} autoFocus maxLength={80} value={nickname} onChangeText={setNickname} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
              <Pressable accessibilityRole="button" disabled={busy || !nickname.trim()} onPress={() => void saveNickname(account)} style={[styles.smallButton, { borderColor: colors.primary }]}>
                <Text style={[styles.smallButtonText, { color: colors.primary }]}>Save</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditingAccountId(null)} style={[styles.smallButton, { borderColor: colors.border }]}>
                <Text style={[styles.smallButtonText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.accountName, { color: colors.foreground }]}>{account.display_name || account.name || "Savings"}{account.mask ? ` •••• ${account.mask}` : ""}</Text>
              <Pressable accessibilityRole="button" onPress={() => { setEditingAccountId(account.id); setNickname(account.display_name || account.name || ""); }} style={[styles.smallButton, { borderColor: colors.border }]}>
                <Text style={[styles.smallButtonText, { color: colors.primary }]}>Rename</Text>
              </Pressable>
            </>
          )}
        </View>
      )) : null}

      {statusState === "ready" ? <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openLink("create")} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.72 : 1 }]}>
          {activeAction === "connect" ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="plus-circle" size={16} color={colors.primaryForeground} />}
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Connect account</Text>
        </Pressable>
        {(status.items || []).length ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setActiveAction("sync"); void sync().catch(error => setMessage(error instanceof Error ? error.message : "Could not refresh bank activity.")).finally(() => setActiveAction(null)); }} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            {activeAction === "sync" ? <ActivityIndicator color={colors.primary} /> : <Feather name="refresh-cw" size={15} color={colors.primary} />}
            <Text style={[styles.smallButtonText, { color: colors.primary }]}>Refresh</Text>
          </Pressable>
        ) : null}
      </View> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  flex: { flex: 1 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 3 },
  note: { fontSize: 13, lineHeight: 19 },
  statusNotice: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  statusError: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, alignItems: "flex-start" },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  itemName: { fontSize: 14, fontWeight: "700" },
  itemStatus: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  smallButton: { minHeight: 44, minWidth: 72, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 11 },
  smallButtonText: { fontSize: 12, fontWeight: "700" },
  account: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  accountName: { flex: 1, fontSize: 13, fontWeight: "600" },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primaryButton: { flexGrow: 1, minHeight: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  primaryButtonText: { fontSize: 14, fontWeight: "800" },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  message: { fontSize: 12, lineHeight: 18 },
});

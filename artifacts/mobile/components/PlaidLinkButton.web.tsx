"use client";

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { usePlaidLink } from "react-plaid-link";

import { supabase } from "@/lib/supabase";
import { useBudget } from "@/context/BudgetContext";

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

type Status = {
  items?: Array<{ institution_name?: string | null; status?: string | null; error_code?: string | null }>;
  accounts?: Array<{ name?: string | null; mask?: string | null }>;
};

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
  const { activeHousehold } = useBudget();
  const householdId = activeHousehold?.householdId ?? "";
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const opened = useRef(false);

  const loadStatus = useCallback(async () => {
    const session = await getFreshSession();
    if (!session) return;
    try {
      const response = await fetch("/api/plaid/status", {
        credentials: "include",
        headers: { Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId },
      });
      if (response.ok) setStatus((await response.json()) as Status);
    } catch {
      // Status is informational; the connect action reports actionable errors.
    }
  }, [householdId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const finish = useCallback((text: string) => {
    setLinkToken(null);
    setBusy(false);
    opened.current = false;
    setMessage(text);
  }, []);

  const onSuccess = useCallback(async (publicToken: string) => {
    try {
      const session = await getFreshSession();
      if (!session) return finish("Please sign in again before finishing the connection.");
      const response = await fetch("/api/plaid/exchange-public-token", {
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
      if (!response.ok) throw new Error(result.message || "Could not finish connecting this bank.");
      setStatus((current) => ({ ...current, items: [{ institution_name: result.institution_name, status: result.status }] }));
      finish(result.already_connected
        ? "That account is already connected. FlowLedger kept the existing secure connection."
        : "Bank connected. Recent activity is syncing now.");
      onConnected?.();
      void loadStatus();
    } catch (error) {
      finish(error instanceof Error ? error.message : "Could not finish connecting this bank.");
    }
  }, [finish, householdId, loadStatus, onConnected]);

  const onExit = useCallback(() => finish("Bank connection canceled. You can try again whenever you are ready."), [finish]);
  const { ready, error, open } = usePlaidLink({ token: linkToken, onSuccess, onExit });

  useEffect(() => {
    if (!linkToken || !ready || opened.current) return;
    opened.current = true;
    open();
  }, [linkToken, ready, open]);

  const connect = useCallback(async () => {
    if (busy || linkToken) return;
    setBusy(true);
    setMessage(null);
    opened.current = false;
    const session = await getFreshSession();
    if (!session) {
      setBusy(false);
      setMessage("Please sign in again before connecting a bank.");
      return;
    }
    try {
      const response = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId },
        body: "{}",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.link_token) throw new Error(result.message || "Could not start secure bank linking.");
      setLinkToken(result.link_token);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Could not start secure bank linking.");
    }
  }, [busy, householdId, linkToken]);

  const sync = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const session = await getFreshSession();
      if (!session) throw new Error("Please sign in again before syncing your bank.");
      const response = await fetch("/api/plaid/sync", { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${session.access_token}`, "X-FlowLedger-Household-Id": householdId } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Could not sync bank activity.");
      setMessage("Bank activity is up to date.");
      onConnected?.();
      void loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync bank activity.");
    } finally { setBusy(false); }
  }, [householdId, loadStatus, onConnected]);

  const item = status.items?.[0];
  const connected = Boolean(item);
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: `${colors.success}22` }]}><Feather name="link" size={20} color={colors.success} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{connected ? (item?.institution_name || "Bank connected") : "Connect your bank"}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{connected ? `${status.accounts?.length || 0} account${status.accounts?.length === 1 ? "" : "s"} linked` : "Import recent activity securely through Plaid."}</Text>
        </View>
        {connected && <View style={[styles.status, { backgroundColor: `${colors.success}22` }]}><Text style={[styles.statusText, { color: colors.success }]}>Connected</Text></View>}
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Plaid keeps credentials with your bank. FlowLedger receives only the account and transaction data you approve.</Text>
      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={connect} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 }]}>
          {busy && !connected ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="link" size={16} color={colors.primaryForeground} />}
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{connected ? "Connect another bank" : "Connect bank"}</Text>
        </Pressable>
        {connected && <Pressable disabled={busy} onPress={sync} style={({ pressed }) => [styles.secondary, { borderColor: colors.border, opacity: pressed || busy ? 0.7 : 1 }]}><Feather name="refresh-cw" size={15} color={colors.primary} /><Text style={[styles.secondaryText, { color: colors.primary }]}>Sync now</Text></Pressable>}
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
  actions: { gap: 10 },
  button: { minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  secondary: { minHeight: 44, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  secondaryText: { fontSize: 14, fontWeight: "700" },
  message: { fontSize: 13, lineHeight: 19 },
});

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

// API base: on web use relative path; on device use the Replit proxy domain
const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}/api`;

const PLAID_STORAGE_KEY = "@plaid_connection_v1";

interface PlaidAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  balance_available: number | null;
}

interface PlaidConnection {
  access_token: string;
  institution: string;
  accounts: PlaidAccount[];
  connected_at: string;
}

function randomSession() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function PlaidLinkSection() {
  const c = useColors();
  const [connection, setConnection] = useState<PlaidConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [loadingTx, setLoadingTx] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<string>("");

  useEffect(() => {
    AsyncStorage.getItem(PLAID_STORAGE_KEY).then(raw => {
      if (raw) setConnection(JSON.parse(raw));
    });
    return () => stopPolling();
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPolling = (session: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/plaid/poll?session=${session}`);
        const data = await res.json();
        if (data.ready) {
          stopPolling();
          setStatus("Exchanging token…");
          await exchangeToken(data.public_token, data.institution ?? "Your Bank");
        }
      } catch {
        // network blip — keep polling
      }
    }, 2000);
  };

  const exchangeToken = async (publicToken: string, institution: string) => {
    try {
      const res = await fetch(`${API_BASE}/plaid/exchange-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Exchange failed");
      const conn: PlaidConnection = {
        access_token: data.access_token,
        institution,
        accounts: data.accounts,
        connected_at: new Date().toISOString(),
      };
      await AsyncStorage.setItem(PLAID_STORAGE_KEY, JSON.stringify(conn));
      setConnection(conn);
      setStatus("");
    } catch (e: any) {
      Alert.alert("Connection Error", e.message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setStatus("Opening Plaid…");
    const session = randomSession();
    sessionRef.current = session;

    // Start polling BEFORE opening the browser so we don't miss the callback
    startPolling(session);

    try {
      const linkUrl = `${API_BASE}/plaid/link?session=${session}`;
      await WebBrowser.openBrowserAsync(linkUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        dismissButtonStyle: "cancel",
      });
      // Browser closed — if polling already got the token it will self-stop.
      // If user cancelled, stop polling and reset.
      setTimeout(() => {
        if (pollRef.current) {
          stopPolling();
          setLoading(false);
          setStatus("");
        }
      }, 3000);
    } catch (e: any) {
      stopPolling();
      Alert.alert("Error", e.message);
      setLoading(false);
      setStatus("");
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Bank",
      "This removes the connection. Your manually entered bills and history won't be affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.removeItem(PLAID_STORAGE_KEY);
            setConnection(null);
          },
        },
      ]
    );
  };

  const handleRefreshTransactions = async () => {
    if (!connection) return;
    setLoadingTx(true);
    try {
      const res = await fetch(`${API_BASE}/plaid/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: connection.access_token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      Alert.alert("Synced", `${data.transactions.length} transactions from last 30 days.`);
    } catch (e: any) {
      Alert.alert("Sync Error", e.message);
    } finally {
      setLoadingTx(false);
    }
  };

  // ── Connected state ──────────────────────────────────────────────────────
  if (connection) {
    return (
      <View style={[s.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        <View style={s.connectedHeader}>
          <View style={[s.iconBox, { backgroundColor: c.success + "20" }]}>
            <Feather name="check-circle" size={18} color={c.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.connectedTitle, { color: c.foreground }]}>{connection.institution}</Text>
            <Text style={[s.connectedSub, { color: c.mutedForeground }]}>
              Connected · {connection.accounts.length} account{connection.accounts.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <Pressable onPress={handleDisconnect} hitSlop={10}>
            <Feather name="x" size={16} color={c.mutedForeground} />
          </Pressable>
        </View>

        {connection.accounts.map((acct, i) => (
          <View key={acct.id} style={[s.acctRow, { borderTopColor: c.border, borderTopWidth: i > 0 ? 1 : 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.acctName, { color: c.foreground }]}>
                {acct.name}{acct.mask ? ` ···${acct.mask}` : ""}
              </Text>
              <Text style={[s.acctType, { color: c.mutedForeground }]}>
                {acct.subtype ?? acct.type}
              </Text>
            </View>
            {acct.balance_current !== null && (
              <Text style={[s.acctBal, { color: acct.balance_current >= 0 ? c.success : c.destructive }]}>
                ${Math.abs(acct.balance_current).toFixed(2)}
              </Text>
            )}
          </View>
        ))}

        <Pressable
          onPress={handleRefreshTransactions}
          disabled={loadingTx}
          style={({ pressed }) => [s.syncBtn, { backgroundColor: c.primary + "18", borderRadius: 10, opacity: pressed ? 0.7 : 1 }]}
        >
          {loadingTx
            ? <ActivityIndicator size="small" color={c.primary} />
            : <Feather name="refresh-cw" size={14} color={c.primary} />}
          <Text style={[s.syncBtnText, { color: c.primary }]}>
            {loadingTx ? "Syncing…" : "Sync Transactions"}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ── Not connected state ──────────────────────────────────────────────────
  return (
    <View style={[s.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
      <View style={s.unconnectedRow}>
        <View style={[s.iconBox, { backgroundColor: c.primary + "18", width: 48, height: 48, borderRadius: 14 }]}>
          <Feather name="link" size={20} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.unconnectedTitle, { color: c.foreground }]}>Connect Your Bank</Text>
          <Text style={[s.unconnectedSub, { color: c.mutedForeground }]}>
            Securely link via Plaid to see real balances and transactions
          </Text>
        </View>
      </View>

      <Pressable
        onPress={handleConnect}
        disabled={loading}
        style={({ pressed }) => [s.connectBtn, { opacity: pressed ? 0.85 : 1 }]}
      >
        {loading
          ? <ActivityIndicator size="small" color="#fff" />
          : <Feather name="link-2" size={15} color="#fff" />}
        <Text style={s.connectBtnText}>{loading ? (status || "Connecting…") : "Connect Bank Account"}</Text>
      </Pressable>

      {loading && (
        <Text style={[s.statusText, { color: c.mutedForeground }]}>
          Complete the connection in the browser, then return here
        </Text>
      )}

      <Text style={[s.sandboxNote, { color: c.mutedForeground }]}>
        🔒 Sandbox mode · use username: <Text style={{ color: c.foreground }}>user_good</Text> / password: <Text style={{ color: c.foreground }}>pass_good</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:             { padding: 16, marginBottom: 12 },
  iconBox:          { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  connectedHeader:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  connectedTitle:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  connectedSub:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  acctRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  acctName:         { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  acctType:         { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textTransform: "capitalize" },
  acctBal:          { fontSize: 14, fontFamily: "Inter_700Bold" },
  syncBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, marginTop: 10 },
  syncBtnText:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  unconnectedRow:   { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  unconnectedTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  unconnectedSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  connectBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, backgroundColor: "#1d4ed8" },
  connectBtnText:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  statusText:       { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
  sandboxNote:      { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
});

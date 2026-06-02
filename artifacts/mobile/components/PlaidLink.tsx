import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import colors from "@/constants/colors";
import { useColors } from "@/hooks/useColors";

const API_BASE = Platform.OS === "web"
  ? "/api"
  : `https://${process.env.EXPO_PUBLIC_API_HOST ?? "localhost"}/api`;

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

export function PlaidLinkSection() {
  const c = useColors();
  const [connection, setConnection] = useState<PlaidConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTx, setLoadingTx] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PLAID_STORAGE_KEY).then(raw => {
      if (raw) setConnection(JSON.parse(raw));
    });
  }, []);

  // Handle deep-link redirect from Plaid Link page
  useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      if (url.startsWith("mobile://plaid-success")) {
        const parsed = Linking.parse(url);
        const publicToken = parsed.queryParams?.["public_token"] as string | undefined;
        const institution = parsed.queryParams?.["institution"] as string | undefined;
        if (!publicToken) return;
        await exchangeToken(publicToken, institution ?? "Your Bank");
      } else if (url.startsWith("mobile://plaid-exit")) {
        setLoading(false);
      }
    });
    return () => sub.remove();
  }, []);

  const exchangeToken = async (publicToken: string, institution: string) => {
    setLoading(true);
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
    } catch (e: any) {
      Alert.alert("Connection Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      // Use WebBrowser to open the server-hosted Plaid Link page
      const linkUrl = `${API_BASE}/plaid/link`;
      await WebBrowser.openBrowserAsync(linkUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        dismissButtonStyle: "cancel",
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Bank",
      "This removes the connection to your bank. Your manually entered bills and history won't be affected.",
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
      Alert.alert(
        "Transactions Synced",
        `Fetched ${data.transactions.length} transactions from the last 30 days.`
      );
    } catch (e: any) {
      Alert.alert("Sync Error", e.message);
    } finally {
      setLoadingTx(false);
    }
  };

  if (connection) {
    return (
      <View style={[s.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
        {/* Connected header */}
        <View style={s.connectedHeader}>
          <View style={[s.connectedDot, { backgroundColor: c.success + "20" }]}>
            <Feather name="check-circle" size={18} color={c.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.connectedTitle, { color: c.foreground }]}>{connection.institution}</Text>
            <Text style={[s.connectedSub, { color: c.mutedForeground }]}>
              Connected · {connection.accounts.length} account{connection.accounts.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <Pressable onPress={handleDisconnect} hitSlop={8}>
            <Feather name="x" size={16} color={c.mutedForeground} />
          </Pressable>
        </View>

        {/* Account list */}
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

        {/* Sync button */}
        <Pressable
          onPress={handleRefreshTransactions}
          disabled={loadingTx}
          style={({ pressed }) => [s.syncBtn, { backgroundColor: c.primary + "18", opacity: pressed ? 0.7 : 1, borderRadius: 10 }]}
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

  return (
    <View style={[s.card, { backgroundColor: c.card, borderRadius: colors.radius }]}>
      <View style={s.unconnectedRow}>
        <View style={[s.bankIcon, { backgroundColor: c.primary + "18" }]}>
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
        <Text style={s.connectBtnText}>{loading ? "Opening…" : "Connect Bank Account"}</Text>
      </Pressable>
      <Text style={[s.sandboxNote, { color: c.mutedForeground }]}>
        🔒 Sandbox mode — no real data accessed
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:             { padding: 16, marginBottom: 12 },
  connectedHeader:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  connectedDot:     { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  connectedTitle:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  connectedSub:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  acctRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  acctName:         { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  acctType:         { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textTransform: "capitalize" },
  acctBal:          { fontSize: 14, fontFamily: "Inter_700Bold" },
  syncBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, marginTop: 10 },
  syncBtnText:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  unconnectedRow:   { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  bankIcon:         { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  unconnectedTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  unconnectedSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  connectBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, backgroundColor: "#1d4ed8" },
  connectBtnText:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sandboxNote:      { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
});

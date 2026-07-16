import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationStatus,
  sendTestPushNotification,
  type PushNotificationStatus,
} from "@/lib/pushNotifications";

export function NotificationSettings() {
  const c = useColors();
  const { session } = useAuth();
  const [status, setStatus] = useState<PushNotificationStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await getPushNotificationStatus()); }
    catch { setStatus("unsupported"); }
  }, []);

  useEffect(() => {
    void refreshStatus();
    if (typeof window === "undefined") return;
    const refresh = () => { void refreshStatus(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshStatus]);

  const toggle = async (enabled: boolean) => {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        await enablePushNotifications(session.access_token);
        setMessage("Notifications are on for this device.");
      } else {
        await disablePushNotifications(session.access_token);
        setMessage("Notifications are off for this device.");
      }
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update notifications.");
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendTestPushNotification(session.access_token);
      setMessage("Test sent. Check your phone notifications.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the test notification.");
    } finally {
      setBusy(false);
    }
  };

  const enabled = status === "enabled";
  const unavailable = status === "unsupported" || status === "blocked";
  const detail = status === "blocked"
    ? "Notifications are blocked. Allow them for FlowLedger in your phone or browser settings."
    : status === "unsupported"
      ? "This browser or app does not support FlowLedger phone notifications."
      : "Get a private alert when bank activity is pending and again when it posts for review.";

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="bell" size={20} color={c.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: c.foreground }]}>Bank activity alerts</Text>
          <Text style={[styles.description, { color: c.mutedForeground }]}>{detail}</Text>
        </View>
        <Switch
          accessibilityLabel="Pending and posted bank transaction notifications"
          disabled={busy || status === "checking" || unavailable}
          value={enabled}
          onValueChange={value => void toggle(value)}
          trackColor={{ false: c.border, true: c.primary + "88" }}
          thumbColor={enabled ? c.primary : c.mutedForeground}
        />
      </View>

      <View style={[styles.privacy, { backgroundColor: c.muted, borderColor: c.border }]}>
        <Feather name="lock" size={14} color={c.success} />
        <Text style={[styles.privacyText, { color: c.mutedForeground }]}>
          Lock-screen alerts hide the merchant and amount. Pending alerts open Activity; posted alerts open Review Center.
        </Text>
      </View>

      {enabled ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void sendTest()}
          style={({ pressed }) => [
            styles.testButton,
            { backgroundColor: c.primary, opacity: busy ? 0.5 : pressed ? 0.78 : 1 },
          ]}
        >
          <Feather name="send" size={15} color={c.primaryForeground} />
          <Text style={[styles.testText, { color: c.primaryForeground }]}>Send test notification</Text>
        </Pressable>
      ) : null}

      {message ? <Text style={[styles.message, { color: message.includes("Could not") || message.includes("blocked") ? c.destructive : c.primary }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  description: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  privacy: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  privacyText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  testButton: { minHeight: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  testText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  message: { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 17 },
});

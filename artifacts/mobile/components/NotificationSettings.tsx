import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { desktopPalette as palette } from "@/components/desktop/DesktopUI";
import { isCompactSettingsLayout } from "@/lib/settingsLayout";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPreferences,
  getPushNotificationStatus,
  sendTestPushNotification,
  updateNotificationPreference,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  type PushNotificationStatus,
} from "@/lib/pushNotifications";

type AlertOption = {
  key: NotificationPreferenceKey;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
  adminOnly?: boolean;
};

const ALERT_OPTIONS: AlertOption[] = [
  {
    key: "pending_transactions",
    icon: "clock",
    title: "Pending bank activity",
    description:
      "When a bank charge is pending. It stays out of your totals until it posts.",
  },
  {
    key: "posted_transactions",
    icon: "check-circle",
    title: "Posted transactions",
    description:
      "When a posted transaction is ready to match in Review Center.",
  },
  {
    key: "overdue_bills",
    icon: "alert-circle",
    title: "Past-due bills",
    description:
      "When a planned bill passes its due date with money still left to pay.",
  },
  {
    key: "feedback_updates",
    icon: "message-square",
    title: "Feedback updates",
    description: "When FlowLedger replies to or completes feedback you sent.",
  },
  {
    key: "admin_feedback",
    icon: "inbox",
    title: "New tester feedback",
    description: "When a tester sends feedback to the admin inbox.",
    adminOnly: true,
  },
];

interface NotificationSettingsProps {
  scope?: "user" | "admin";
  appearance?: "theme" | "desktop" | "settings";
}

export function NotificationSettings({
  scope = "user",
  appearance = "theme",
}: NotificationSettingsProps) {
  const themeColors = useColors();
  const isDesktop = appearance !== "theme";
  const isSettings = appearance === "settings";
  const c = isDesktop ? {
    ...themeColors,
    card: palette.surface,
    foreground: palette.text,
    mutedForeground: palette.muted,
    muted: palette.surfaceMuted,
    border: palette.border,
    primary: palette.purple,
    success: palette.green,
    destructive: palette.red,
  } : themeColors;
  const primarySoft = isDesktop ? palette.purpleSoft : c.primary + "18";
  const primaryFaint = isDesktop ? palette.purpleSoft : c.primary + "14";
  const primaryBorder = isDesktop ? palette.purple : c.primary + "66";
  const primaryTrack = isDesktop ? palette.purple : c.primary + "88";
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactSettingsLayout(viewportWidth);
  const { session, user } = useAuth();
  const { activeHousehold } = useBudget();
  const [status, setStatus] = useState<PushNotificationStatus>("checking");
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [isFeedbackAdmin, setIsFeedbackAdmin] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<NotificationPreferenceKey | null>(
    null,
  );
  const [testingKey, setTestingKey] =
    useState<NotificationPreferenceKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!user?.id) {
      setStatus("disabled");
      return;
    }
    try {
      setStatus(await getPushNotificationStatus(user.id, session?.access_token, activeHousehold?.householdId));
    } catch (error) {
      setStatus("degraded");
      setMessage(error instanceof Error ? error.message : "Notification registration could not be confirmed. Retry when the service is available.");
    }
  }, [activeHousehold?.householdId, session?.access_token, user?.id]);

  const refreshPreferences = useCallback(async () => {
    if (!session?.access_token) {
      setPreferencesLoading(false);
      return;
    }
    setPreferencesLoading(true);
    try {
      const result = await getNotificationPreferences(session.access_token);
      setPreferences(result.preferences);
      setIsFeedbackAdmin(result.isFeedbackAdmin);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load notification choices.",
      );
    } finally {
      setPreferencesLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void refreshStatus();
    void refreshPreferences();
    if (typeof window === "undefined") return;
    const refresh = () => {
      void refreshStatus();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshPreferences, refreshStatus]);

  const toggleDevice = async (enabled: boolean) => {
    if (!session?.access_token || !user?.id || deviceBusy) return;
    setDeviceBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        await enablePushNotifications(session.access_token, user.id, activeHousehold?.householdId);
        setMessage("Phone notifications are on for this device.");
      } else {
        await disablePushNotifications(session.access_token, user.id);
        setMessage("Phone notifications are off for this device.");
      }
      await refreshStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update notifications.",
      );
      await refreshStatus();
    } finally {
      setDeviceBusy(false);
    }
  };

  const togglePreference = async (
    key: NotificationPreferenceKey,
    enabled: boolean,
  ) => {
    if (!session?.access_token || savingKey) return;
    setSavingKey(key);
    setMessage(null);
    try {
      const saved = await updateNotificationPreference(
        session.access_token,
        key,
        enabled,
      );
      setPreferences(saved);
      setMessage("Notification choices saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save that notification choice.",
      );
    } finally {
      setSavingKey(null);
    }
  };

  const sendTest = async (option: AlertOption) => {
    if (!session?.access_token || deviceBusy || testingKey) return;
    setTestingKey(option.key);
    setMessage(null);
    try {
      await sendTestPushNotification(session.access_token, option.key, activeHousehold?.householdId);
      setMessage(`${option.title} test sent. Check your phone notifications.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not send the test notification.",
      );
    } finally {
      setTestingKey(null);
    }
  };

  const enabled = status === "enabled";
  const unavailable = status === "unsupported" || status === "blocked";
  const detail =
    status === "blocked"
      ? "Notifications are blocked. Allow them for FlowLedger in your phone or browser settings."
      : status === "unsupported"
        ? "This browser or app does not support FlowLedger phone notifications."
        : status === "degraded"
          ? "Notifications need to be reconnected for this household. Turn them on again to retry."
        : "Allow this device to receive the alerts you choose below.";

  const options = ALERT_OPTIONS.filter((option) =>
    scope === "admin" ? option.adminOnly && isFeedbackAdmin : !option.adminOnly,
  );

  return (
    <View style={[styles.container, isDesktop && styles.desktopContainer, isSettings && styles.settingsContainer]}>
      {scope === "user" ? (
        <View
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <View style={[styles.row, compactLayout && styles.rowCompact]}>
            <View style={[styles.icon, { backgroundColor: primarySoft }]}>
              <Feather name="bell" size={20} color={c.primary} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: c.foreground }]}>
                Phone notifications
              </Text>
              <Text style={[styles.description, { color: c.mutedForeground }]}>
                {detail}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Phone notifications on this device"
              disabled={
                deviceBusy ||
                testingKey !== null ||
                status === "checking" ||
                unavailable
              }
              value={enabled}
              onValueChange={(value) => void toggleDevice(value)}
              trackColor={{ false: c.border, true: primaryTrack }}
              thumbColor={enabled ? c.primary : c.mutedForeground}
              style={compactLayout ? styles.switchCompact : undefined}
            />
          </View>
        </View>
      ) : null}

      {!isSettings ? <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          {scope === "admin" ? "Admin alerts" : "Choose your alerts"}
        </Text>
        <Text style={[styles.sectionDescription, { color: c.mutedForeground }]}>
          {scope === "admin"
            ? "Get notified when new tester feedback arrives."
            : "These choices follow your account on every device."}
        </Text>
      </View> : null}

      <View
        style={[
          styles.optionsCard,
          isDesktop && styles.desktopOptionsCard,
          isSettings && styles.settingsOptionsCard,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        {options.map((option, index) => (
          <View
            key={option.key}
            style={[
              styles.optionRow,
              isDesktop && styles.desktopOptionRow,
              compactLayout && styles.optionRowCompact,
              index < options.length - 1
                ? { borderBottomWidth: 1, borderBottomColor: c.border }
                : null,
            ]}
          >
            <View
              style={[styles.smallIcon, { backgroundColor: primaryFaint }]}
            >
              <Feather name={option.icon} size={17} color={c.primary} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.optionTitle, { color: c.foreground }]}>
                {option.title}
              </Text>
              <Text style={[styles.description, { color: c.mutedForeground }]}>
                {option.description}
              </Text>
              {enabled ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Test ${option.title} notification`}
                  disabled={
                    !preferences[option.key] ||
                    testingKey !== null ||
                    savingKey !== null
                  }
                  onPress={() => void sendTest(option)}
                  style={({ pressed }) => [
                    styles.inlineTest,
                    {
                      borderColor: primaryBorder,
                      backgroundColor: primaryFaint,
                      opacity:
                        !preferences[option.key] ||
                        testingKey !== null ||
                        savingKey !== null
                          ? 0.45
                          : pressed
                            ? 0.7
                            : 1,
                    },
                  ]}
                >
                  <Feather name="send" size={12} color={c.primary} />
                  <Text style={[styles.inlineTestText, { color: c.primary }]}>
                    {testingKey === option.key ? "Sending…" : "Test alert"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Switch
              accessibilityLabel={`${option.title} notifications`}
              disabled={
                preferencesLoading || savingKey !== null || testingKey !== null
              }
              value={preferences[option.key]}
              onValueChange={(value) =>
                void togglePreference(option.key, value)
              }
              trackColor={{ false: c.border, true: primaryTrack }}
              thumbColor={
                preferences[option.key] ? c.primary : c.mutedForeground
              }
              style={compactLayout ? styles.switchCompact : undefined}
            />
          </View>
        ))}
      </View>

      {scope === "user" ? (
        <View
          style={[
            styles.privacy,
            { backgroundColor: c.muted, borderColor: c.border },
          ]}
        >
          <Feather name="lock" size={14} color={c.success} />
          <Text style={[styles.privacyText, { color: c.mutedForeground }]}>
            Lock-screen alerts hide bill, merchant, and amount details. Opening
            an alert takes you to the right place in FlowLedger.
          </Text>
        </View>
      ) : !enabled ? (
        <Text style={[styles.message, { color: c.mutedForeground }]}>
          Turn on phone notifications in Settings → Notifications to receive
          this alert.
        </Text>
      ) : null}

      {message ? (
        <Text
          style={[
            styles.message,
            {
              color:
                message.includes("Could not") || message.includes("blocked")
                  ? c.destructive
                  : c.primary,
            },
          ]}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  desktopContainer: { gap: 12 },
  settingsContainer: { gap: 0 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowCompact: { alignItems: "stretch", flexDirection: "column", gap: 9 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  smallIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  description: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  sectionHeading: { gap: 3, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sectionDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  optionsCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  desktopOptionsCard: { borderRadius: 10 },
  settingsOptionsCard: { borderWidth: 0, borderRadius: 0 },
  optionRow: {
    minHeight: 82,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  desktopOptionRow: { minHeight: 66, paddingHorizontal: 15, paddingVertical: 11 },
  optionRowCompact: { alignItems: "stretch", flexDirection: "column", gap: 9 },
  optionTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  inlineTest: {
    alignSelf: "flex-start",
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 5,
  },
  inlineTestText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  privacy: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  privacyText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
  message: { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 17 },
  switchCompact: { alignSelf: "flex-end" },
});

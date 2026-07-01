import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs, useRouter, useSegments } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { DECISION_HUB_SETTINGS_EVENT, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";

const TABS = [
  { name: "index",        title: "Dashboard",    icon: "bar-chart-2"     },
  { name: "bills",        title: "Bills",        icon: "file-text"       },
  { name: "flo",          title: "Flo",          icon: "message-circle"  },
  { name: "transactions", title: "Transactions", icon: "repeat"          },
  { name: "monthly",      title: "Monthly",      icon: "calendar"        },
  { name: "more",         title: "More",         icon: "more-horizontal" },
] as const;

function BudgetLoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <View style={styles.loadingMark}>
        <Text style={styles.loadingMarkText}>F</Text>
      </View>
      <Text style={[styles.loadingTitle, { color: colors.foreground }]}>FlowLedger</Text>
      <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>Loading your plan…</Text>
    </View>
  );
}

function demoHintForRoute(routeName: string) {
  if (routeName === "monthly") return "Monthly is the plan view. Tap a day to see the balance, bills, income, and decisions behind it.";
  if (routeName === "bills") return "Bills is where obligations and debts live. Try the demo snowball and bill-priority tools.";
  if (routeName === "transactions") return "Transactions is the activity trail. These are fake entries so you can explore safely.";
  if (routeName === "flo") return "Ask Flo: “Can I afford $500 on July 15?” She will preview the decision before anything applies.";
  if (routeName === "more") return "More is where settings, setup, accounts, imports, and app controls live.";
  return "Dashboard shows the story at a glance: balance, lowest forecast, bills, debt, and what needs attention.";
}

function DemoModeBanner() {
  const colors = useColors();
  const router = useRouter();
  const segments = useSegments();
  const { stopDemoMode, resetDemoMode } = useAuth();
  const [expanded, setExpanded] = React.useState(true);
  const routeName = String(segments[segments.length - 1] ?? "index");
  const hint = demoHintForRoute(routeName);

  const startRealSetup = () => {
    stopDemoMode();
    router.replace("/setup" as any);
  };

  const resetDemo = () => {
    resetDemoMode();
    router.replace("/(tabs)" as any);
  };

  const askSampleQuestion = () => {
    router.push({ pathname: "/(tabs)/flo", params: { prompt: "Can I afford $500 on July 15?" } } as any);
  };

  return (
    <View style={[styles.demoBanner, { borderColor: colors.primary + "55" }]}>
      <Pressable onPress={() => setExpanded(value => !value)} style={styles.demoBannerHeader}>
        <View style={styles.demoBadge}>
          <Feather name="play" size={13} color="#bae6fd" />
          <Text style={styles.demoBadgeText}>Sample data</Text>
        </View>
        <Text style={styles.demoBannerTitle}>{expanded ? "Demo mode is on" : "Sample budget"}</Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#93c5fd" />
      </Pressable>
      {expanded ? (
        <>
          <Text style={styles.demoBannerBody}>{hint}</Text>
          <View style={styles.demoButtonRow}>
            <Pressable onPress={() => setExpanded(false)} style={styles.demoSmallButton}>
              <Text style={styles.demoSmallButtonText}>Keep exploring</Text>
            </Pressable>
            <Pressable onPress={askSampleQuestion} style={styles.demoSmallButton}>
              <Text style={styles.demoSmallButtonText}>Ask Flo</Text>
            </Pressable>
          </View>
          <View style={styles.demoButtonRow}>
            <Pressable onPress={resetDemo} style={styles.demoSmallButton}>
              <Text style={styles.demoSmallButtonText}>Reset demo</Text>
            </Pressable>
            <Pressable onPress={startRealSetup} style={[styles.demoSmallButton, styles.demoPrimaryButton]}>
              <Text style={styles.demoPrimaryButtonText}>Start my real setup</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function TabContent() {
  const colors = useColors();
  const { loading, demoMode, decisions, getDailyBalances, settings } = useBudget();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const [decisionHubSettings, setDecisionHubSettings] = React.useState<DecisionHubSettings>(() => readDecisionHubSettings());

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const refresh = () => setDecisionHubSettings(readDecisionHubSettings());
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
    return () => globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
  }, []);

  const attentionCount = React.useMemo(() => {
    if (loading || !decisionHubSettings.floTabBadgeEnabled) return 0;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const weekEndDate = new Date(now);
    weekEndDate.setDate(now.getDate() + 7);
    const weekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, "0")}-${String(weekEndDate.getDate()).padStart(2, "0")}`;
    const forecastDays: { date: string; balance: number }[] = [];
    for (let index = 0; index < Math.max(1, Math.min(settings.forecast_horizon_months, 2)); index += 1) {
      const absoluteMonth = now.getMonth() + index;
      const month = absoluteMonth % 12;
      const year = now.getFullYear() + Math.floor(absoluteMonth / 12);
      getDailyBalances(month, year).forEach(day => {
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
        if (date >= today) forecastDays.push({ date, balance: day.balance });
      });
    }
    const history = decisionHubSettings.plannedDecisionReviewAlertsEnabled
      ? buildDecisionHistory(decisions, today, now.toISOString())
      : { due: [] };
    const risky = decisionHubSettings.plannedDecisionReviewAlertsEnabled
      ? buildDecisionRiskAlerts(decisions, forecastDays, settings.safety_floor, today).length
      : 0;
    const sensitivityBuffer = decisionHubSettings.alertSensitivity === "conservative"
      ? 300
      : decisionHubSettings.alertSensitivity === "quiet"
        ? 0
        : 150;
    const lowNextWeek = decisionHubSettings.lowBalanceAlertsEnabled
      && forecastDays.some(day => day.date >= today && day.date <= weekEnd && day.balance < settings.safety_floor + sensitivityBuffer);
    return Math.min(9, history.due.length + risky + (lowNextWeek ? 1 : 0));
  }, [decisionHubSettings, decisions, getDailyBalances, loading, settings.forecast_horizon_months, settings.safety_floor]);

  if (loading) return <BudgetLoadingScreen />;

  return (
    <>
      <Tabs
        detachInactiveScreens={false}
        screenOptions={{
          animation: "none",
          freezeOnBlur: !isWeb,
          lazy: true,
          tabBarActiveTintColor: "#22c55e",
          tabBarInactiveTintColor: colors.mutedForeground,
          headerShown: false,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : colors.background,
            borderTopWidth: isWeb ? 1 : 0,
            borderTopColor: colors.border,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={100}
                tint={isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            ) : isWeb ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
            ) : null,
        }}
      >
        {TABS.map(tab => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarBadge: tab.name === "flo" && attentionCount > 0 ? attentionCount : undefined,
              tabBarBadgeStyle: tab.name === "flo" ? { backgroundColor: colors.destructive, color: "#fff", fontSize: 10 } : undefined,
              tabBarActiveTintColor: tab.name === "flo" ? colors.primary : undefined,
              tabBarInactiveTintColor: tab.name === "flo" ? colors.primary : undefined,
              tabBarIcon: ({ color }) => tab.name === "flo"
                ? <FloLogo size={24} ring={false} />
                : <Feather name={tab.icon} size={22} color={color} />,
            }}
          />
        ))}
        <Tabs.Screen name="category-budget" options={{ href: null }} />
      </Tabs>
      {demoMode ? <DemoModeBanner /> : null}
      <SaveStatusBanner />
      <DecisionDueModal />
    </>
  );
}

export default function TabLayout() {
  return (
    <BudgetProvider>
      <TabContent />
    </BudgetProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37,99,235,0.18)",
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.35)",
    marginBottom: 12,
  },
  loadingMarkText: {
    color: "#2563eb",
    fontSize: 28,
    fontWeight: "800",
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: "800",
  },
  loadingSub: {
    fontSize: 14,
    marginTop: 4,
  },
  demoBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 14,
    left: 14,
    right: 14,
    zIndex: 80,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(15,23,42,0.96)",
    shadowColor: "#2563eb",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  demoBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  demoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(37,99,235,0.22)",
  },
  demoBadgeText: {
    color: "#bfdbfe",
    fontSize: 11,
    fontWeight: "800",
  },
  demoBannerTitle: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "800",
  },
  demoBannerBody: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },
  demoButtonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  demoSmallButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,41,59,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  demoSmallButtonText: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  demoPrimaryButton: {
    backgroundColor: "#2563eb",
    borderColor: "#60a5fa",
  },
  demoPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});

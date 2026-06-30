import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, View, useColorScheme } from "react-native";

import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
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

function TabContent() {
  const colors = useColors();
  const { loading, decisions, getDailyBalances, settings } = useBudget();
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
              tabBarIcon: ({ color }) => <Feather name={tab.icon} size={22} color={tab.name === "flo" ? colors.primary : color} />,
            }}
          />
        ))}
        <Tabs.Screen name="category-budget" options={{ href: null }} />
      </Tabs>
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
});

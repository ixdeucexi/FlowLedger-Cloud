import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs, useRouter, useSegments } from "expo-router";
import React from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { buildDecisionHistory } from "@/lib/decisionHistory";
import { buildDecisionRiskAlerts } from "@/lib/decisionRisk";
import { DECISION_HUB_SETTINGS_EVENT, readDecisionHubSettings, type DecisionHubSettings } from "@/lib/decisionHubSettings";
import { isAlgorithmEnabled } from "@/lib/algorithmCatalog";
import { clearStoredSetupStep } from "@/lib/setupProgress";

const TABS = [
  { name: "index",        title: "Dashboard",    icon: "bar-chart-2"     },
  { name: "bills",        title: "Bills",        icon: "file-text"       },
  { name: "flo",          title: "Flo",          icon: "message-circle"  },
  { name: "transactions", title: "Transactions", icon: "repeat"          },
  { name: "monthly",      title: "Monthly",      icon: "calendar"        },
  { name: "more",         title: "More",         icon: "more-horizontal" },
] as const;

const DEMO_TOUR_KEY = "flowledger_demo_tour_step";
const DEMO_TOUR_STEPS = [
  {
    route: "index",
    title: "Dashboard",
    path: "/(tabs)",
    nextLabel: "Open Monthly",
    short: "This is the quick answer page.",
    detail: "Dashboard is where a user checks the headline: balance today, lowest forecast, bills paid, unpaid bills, debt, upcoming bills, and anything Flo thinks needs attention.",
  },
  {
    route: "monthly",
    title: "Monthly",
    path: "/(tabs)/monthly",
    nextLabel: "Open Bills",
    short: "This is the calendar and plan view.",
    detail: "Monthly shows how money moves day by day. Tap a date to see the income, bills, transactions, planned decisions, and projected balance for that day.",
  },
  {
    route: "bills",
    title: "Bills",
    path: "/(tabs)/bills",
    nextLabel: "Open Transactions",
    short: "This is where obligations are set up.",
    detail: "Bills holds recurring bills and debts. This is where a user manages due dates, minimum payments, snowball settings, and recurring obligations.",
  },
  {
    route: "transactions",
    title: "Transactions",
    path: "/(tabs)/transactions",
    nextLabel: "Open Flo",
    short: "This is what actually happened.",
    detail: "Transactions is the activity log. It shows spending, income, transfers, debt payments, and anything imported or manually added so the forecast can stay honest.",
  },
  {
    route: "flo",
    title: "Flo",
    path: "/(tabs)/flo",
    nextLabel: "Open Settings",
    short: "This is the action and decision layer.",
    detail: "Flo is where users ask money questions, create plans, preview changes, and get plain-English explanations. Flo should confirm before changing the real plan.",
  },
  {
    route: "more",
    title: "Settings",
    path: "/(tabs)/more",
    nextLabel: "Finish tour",
    short: "This is the control room.",
    detail: "Settings is where users manage accounts, setup, safety cushion, forecast horizon, imports, exports, app install help, Flo memory, and decision settings.",
  },
] as const;

function BudgetLoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <Image
        source={require("../../assets/images/logo_transparent.png")}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>Loading your plan…</Text>
    </View>
  );
}

function BudgetLoadErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <Image
        source={require("../../assets/images/logo_transparent.png")}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <Text style={[styles.loadErrorTitle, { color: colors.foreground }]}>Couldn’t load your plan</Text>
      <Text style={[styles.loadErrorBody, { color: colors.mutedForeground }]}>{message}</Text>
      <Pressable onPress={onRetry} style={[styles.loadRetryButton, { backgroundColor: colors.primary }]}>
        <Text style={[styles.loadRetryText, { color: colors.primaryForeground }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

function readDemoTourStep() {
  if (Platform.OS !== "web") return 0;
  try {
    const stored = Number(globalThis.localStorage?.getItem(DEMO_TOUR_KEY) ?? 0);
    return Number.isFinite(stored) ? Math.max(0, Math.min(DEMO_TOUR_STEPS.length - 1, stored)) : 0;
  } catch {
    return 0;
  }
}

function writeDemoTourStep(step: number) {
  if (Platform.OS !== "web") return;
  try {
    globalThis.localStorage?.setItem(DEMO_TOUR_KEY, String(Math.max(0, Math.min(DEMO_TOUR_STEPS.length - 1, step))));
  } catch {}
}

function routeKeyFromSegments(segments: string[]) {
  const known = DEMO_TOUR_STEPS.find(step => segments.includes(step.route));
  return known?.route ?? "index";
}

function demoHintForRoute(routeName: string) {
  if (routeName === "monthly") return "Monthly is the plan view. Tap a day to see the balance, bills, income, and decisions behind it.";
  if (routeName === "bills") return "Bills is where obligations and debts live. Try the demo snowball and due-date tools.";
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
  const [tourStepIndex, setTourStepIndex] = React.useState(readDemoTourStep);
  const [showDetails, setShowDetails] = React.useState(true);
  const routeName = routeKeyFromSegments(segments.map(String));
  const routeStepIndex = DEMO_TOUR_STEPS.findIndex(step => step.route === routeName);
  const activeStepIndex = routeStepIndex >= 0 ? routeStepIndex : tourStepIndex;
  const activeStep = DEMO_TOUR_STEPS[activeStepIndex] ?? DEMO_TOUR_STEPS[0];
  const nextStep = DEMO_TOUR_STEPS[activeStepIndex + 1];

  React.useEffect(() => {
    if (routeStepIndex < 0) return;
    setTourStepIndex(routeStepIndex);
    writeDemoTourStep(routeStepIndex);
    setShowDetails(true);
  }, [routeStepIndex]);

  const startRealSetup = () => {
    clearStoredSetupStep();
    stopDemoMode();
    router.replace("/setup" as any);
  };

  const resetDemo = () => {
    resetDemoMode();
    writeDemoTourStep(0);
    setTourStepIndex(0);
    setShowDetails(true);
    router.replace("/(tabs)" as any);
  };

  const askSampleQuestion = () => {
    router.push({ pathname: "/(tabs)/flo", params: { prompt: "Can I afford $500 on July 15?" } } as any);
  };

  const openNextTourStep = () => {
    if (!nextStep) {
      setExpanded(false);
      return;
    }
    const nextIndex = activeStepIndex + 1;
    setTourStepIndex(nextIndex);
    writeDemoTourStep(nextIndex);
    setShowDetails(true);
    router.push(nextStep.path as any);
  };

  return (
    <View style={[styles.demoBanner, { borderColor: colors.primary + "55" }]}>
      <Pressable onPress={() => setExpanded(value => !value)} style={styles.demoBannerHeader}>
        <View style={styles.demoBadge}>
          <Feather name="play" size={13} color="#bae6fd" />
          <Text style={styles.demoBadgeText}>Live demo</Text>
        </View>
        <Text style={styles.demoBannerTitle}>{expanded ? `${activeStep.title} · ${activeStepIndex + 1} of ${DEMO_TOUR_STEPS.length}` : "Sample budget tour"}</Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#93c5fd" />
      </Pressable>
      {expanded ? (
        <>
          <Pressable onPress={() => setShowDetails(value => !value)} style={styles.demoExplainCard}>
            <View style={styles.demoExplainHeader}>
              <Feather name="info" size={15} color="#38bdf8" />
              <Text style={styles.demoExplainTitle}>{activeStep.short}</Text>
            </View>
            {showDetails ? <Text style={styles.demoBannerBody}>{activeStep.detail}</Text> : null}
            <Text style={styles.demoTapHint}>{showDetails ? "Tap to hide explanation" : "Tap to explain this page"}</Text>
          </Pressable>
          <View style={styles.demoButtonRow}>
            <Pressable onPress={openNextTourStep} style={[styles.demoSmallButton, styles.demoPrimaryButton]}>
              <Text style={styles.demoPrimaryButtonText}>{nextStep ? activeStep.nextLabel : "Finish tour"}</Text>
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
  const { loading, loadError, retryBudgetLoad, demoMode, decisions, getDailyBalances, settings } = useBudget();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const isIosWeb = isWeb && typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [decisionHubSettings, setDecisionHubSettings] = React.useState<DecisionHubSettings>(() => readDecisionHubSettings());

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const refresh = () => setDecisionHubSettings(readDecisionHubSettings());
    globalThis.addEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
    return () => globalThis.removeEventListener?.(DECISION_HUB_SETTINGS_EVENT, refresh);
  }, []);

  const attentionCount = React.useMemo(() => {
    if (loading) return 0;
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
    const shouldReviewDecisions = isAlgorithmEnabled(decisionHubSettings, "purchaseDecision");
    const history = shouldReviewDecisions
      ? buildDecisionHistory(decisions, today, now.toISOString())
      : { due: [] };
    const risky = shouldReviewDecisions
      ? buildDecisionRiskAlerts(decisions, forecastDays, settings.safety_floor, today).length
      : 0;
    const sensitivityBuffer = 150;
    const lowNextWeek = decisionHubSettings.algorithmSuiteEnabled
      && forecastDays.some(day => day.date >= today && day.date <= weekEnd && day.balance < settings.safety_floor + sensitivityBuffer);
    return Math.min(9, history.due.length + risky + (lowNextWeek ? 1 : 0));
  }, [decisionHubSettings, decisions, getDailyBalances, loading, settings.forecast_horizon_months, settings.safety_floor]);

  if (loading) return <BudgetLoadingScreen />;
  if (loadError) return <BudgetLoadErrorScreen message={loadError} onRetry={retryBudgetLoad} />;

  return (
    <>
      <Tabs
        backBehavior="history"
        detachInactiveScreens={false}
        screenOptions={{
          animation: "none",
          freezeOnBlur: !isWeb,
          lazy: true,
          tabBarActiveTintColor: "#8b5cf6",
          tabBarInactiveTintColor: colors.mutedForeground,
          headerShown: false,
          tabBarLabelStyle: {
            fontFamily: "Inter_600SemiBold",
            fontSize: 10,
            marginTop: 1,
          },
          tabBarItemStyle: {
            paddingVertical: 6,
            borderRadius: 18,
          },
          tabBarStyle: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            backgroundColor: isIOS ? "transparent" : "rgba(2,6,23,0.90)",
            borderWidth: 1,
            borderTopWidth: 1,
            borderBottomWidth: 0,
            borderLeftWidth: 0,
            borderRightWidth: 0,
            borderColor: "rgba(148,163,184,0.18)",
            shadowColor: "#7c3aed",
            shadowOffset: { width: 0, height: 14 },
            shadowOpacity: 0.22,
            shadowRadius: 26,
            elevation: 14,
            paddingHorizontal: 6,
            ...(isWeb ? {
              height: isIosWeb ? 72 : 82,
              paddingTop: isIosWeb ? 6 : 8,
              paddingBottom: isIosWeb ? 12 : 10,
            } : {
              height: 86,
              paddingTop: 6,
              paddingBottom: 14,
            }),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={100}
                tint={isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            ) : isWeb ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(2,6,23,0.96)", borderTopLeftRadius: 28, borderTopRightRadius: 28 }]} />
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
  loadingLogo: {
    width: 260,
    height: 108,
    marginBottom: 4,
  },
  loadingSub: {
    fontSize: 14,
    marginTop: 4,
  },
  loadErrorTitle: {
    fontSize: 24,
    fontWeight: "900",
    marginTop: 14,
  },
  loadErrorBody: {
    maxWidth: 320,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  loadRetryButton: {
    minWidth: 160,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 22,
  },
  loadRetryText: {
    fontSize: 16,
    fontWeight: "800",
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
    marginTop: 8,
  },
  demoExplainCard: {
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.18)",
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.74)",
    padding: 10,
    marginTop: 10,
  },
  demoExplainHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  demoExplainTitle: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "800",
  },
  demoTapHint: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
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

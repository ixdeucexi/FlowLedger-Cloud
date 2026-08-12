import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs, useRouter, useSegments } from "expo-router";
import React from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { AppDiscoveryProvider } from "@/context/AppDiscoveryContext";
import { useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
import { FloLogo } from "@/components/FloLogo";
import { FloLauncher } from "@/components/FloLauncher";
import { PlanPreviewBanner } from "@/components/PlanPreviewBanner";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useEffectiveThemeMode } from "@/hooks/useEffectiveThemeMode";
import {
  clearLearningTour,
  LEARNING_TOUR_EVENT,
  LEARNING_TOUR_STEPS,
  readLearningTourState,
  writeLearningTourState,
} from "@/lib/learningTour";
import { clearStoredSetupStep } from "@/lib/setupProgress";
import {
  FeedbackBadgeProvider,
  useFeedbackBadge,
} from "@/context/FeedbackBadgeContext";
import { buildReviewQueue } from "@/lib/reviewCenter";
import { tabBadgeValue } from "@/lib/tabBadge";
import {
  buildOverdueBillOccurrences,
  groupOverdueBills,
} from "@/lib/overdueBills";
import {
  pendingOccurrenceKeySet,
  unmatchedPendingTransactions,
} from "@/lib/pendingPlanMatches";
import { tabBarDisplayLabel, tabBarLabelSize } from "@/lib/mobileLayout";
import {
  appNotificationCount,
  clearAppBadge,
  syncAppBadge,
} from "@/lib/appBadge";
import { MOBILE_RIBBON_ITEMS } from "@/lib/mobileRibbon";

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const DesktopChrome = React.lazy(() =>
  import("@/components/desktop/DesktopChrome").then((module) => ({
    default: module.DesktopChrome,
  })),
);

const DEMO_TOUR_KEY = "flowledger_demo_tour_step";
const DEMO_TOUR_STEPS = [
  {
    route: "index",
    title: "Dashboard",
    path: "/(tabs)",
    nextLabel: "Open Forecast",
    short: "Your money at a glance.",
    detail: "See today's balance, forecast, and next move.",
  },
  {
    route: "monthly",
    title: "Forecast",
    path: "/(tabs)/monthly",
    nextLabel: "Open Bills",
    short: "Your daily forecast.",
    detail: "Tap a date to see what changes its balance.",
  },
  {
    route: "bills",
    title: "Bills",
    path: "/(tabs)/bills",
    nextLabel: "Open Activity",
    short: "Bills and debt.",
    detail: "Manage due dates, minimums, and payoff order.",
  },
  {
    route: "transactions",
    title: "Activity",
    path: "/(tabs)/transactions",
    nextLabel: "Open Flo",
    short: "What actually happened.",
    detail: "See spending, income, transfers, and payments.",
  },
  {
    route: "flo",
    title: "Flo",
    path: "/(tabs)/flo",
    nextLabel: "Open More",
    short: "Ask Flo.",
    detail: "Ask a question or preview a change.",
  },
  {
    route: "more",
    title: "More",
    path: "/(tabs)/more",
    nextLabel: "Finish tour",
    short: "App controls.",
    detail: "Manage accounts, setup, data, and preferences.",
  },
] as const;

function BudgetLoadErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.loadingScreen, { backgroundColor: colors.background }]}
    >
      <Image
        source={require("../../assets/images/startup_f_transparent.png")}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <Text style={[styles.loadErrorTitle, { color: colors.foreground }]}>
        Couldn’t load your plan
      </Text>
      <Text style={[styles.loadErrorBody, { color: colors.mutedForeground }]}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        style={[styles.loadRetryButton, { backgroundColor: colors.primary }]}
      >
        <Text
          style={[styles.loadRetryText, { color: colors.primaryForeground }]}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

function PlanRestoreOverlay({ isDesktop }: { isDesktop: boolean }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Restoring this household"
      style={[
        styles.planRestoreOverlay,
        { backgroundColor: colors.background },
        !isDesktop && styles.planRestoreOverlayMobile,
      ]}
    >
      <View style={styles.planRestoreHeader}>
        <View style={[styles.skeletonTitle, { backgroundColor: colors.muted }]} />
        <View style={[styles.skeletonAction, { backgroundColor: colors.muted }]} />
      </View>
      <Text style={[styles.planRestoreLabel, { color: colors.mutedForeground }]}>Restoring this household…</Text>
      <View style={[styles.skeletonGrid, !isDesktop && styles.skeletonGridMobile]}>
        {[0, 1, 2, 3].map(item => (
          <View
            key={item}
            style={[
              styles.skeletonCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDesktop && styles.skeletonCardMobile,
            ]}
          >
            <View style={[styles.skeletonLineShort, { backgroundColor: colors.muted }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.muted }]} />
          </View>
        ))}
      </View>
      <View style={[styles.skeletonPanel, { backgroundColor: colors.card, borderColor: colors.border }]} />
    </View>
  );
}

function readDemoTourStep() {
  if (Platform.OS !== "web") return 0;
  try {
    const stored = Number(globalThis.localStorage?.getItem(DEMO_TOUR_KEY) ?? 0);
    return Number.isFinite(stored)
      ? Math.max(0, Math.min(DEMO_TOUR_STEPS.length - 1, stored))
      : 0;
  } catch {
    return 0;
  }
}

function writeDemoTourStep(step: number) {
  if (Platform.OS !== "web") return;
  try {
    globalThis.localStorage?.setItem(
      DEMO_TOUR_KEY,
      String(Math.max(0, Math.min(DEMO_TOUR_STEPS.length - 1, step))),
    );
  } catch {}
}

function routeKeyFromSegments(segments: string[]) {
  const known = DEMO_TOUR_STEPS.find((step) => segments.includes(step.route));
  return known?.route ?? "index";
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
  const routeStepIndex = DEMO_TOUR_STEPS.findIndex(
    (step) => step.route === routeName,
  );
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
    router.push({
      pathname: "/(tabs)/flo",
      params: { prompt: "Which account records can you explain?" },
    } as any);
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
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        style={styles.demoBannerHeader}
      >
        <View style={styles.demoBadge}>
          <Feather name="play" size={13} color="#bae6fd" />
          <Text style={styles.demoBadgeText}>Sample plan</Text>
        </View>
        <Text style={styles.demoBannerTitle}>
          {expanded
            ? `${activeStep.title} · ${activeStepIndex + 1} of ${DEMO_TOUR_STEPS.length}`
            : "Sample budget tour"}
        </Text>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="#93c5fd"
        />
      </Pressable>
      {expanded ? (
        <>
          <Pressable
            onPress={() => setShowDetails((value) => !value)}
            style={styles.demoExplainCard}
          >
            <View style={styles.demoExplainHeader}>
              <Feather name="info" size={15} color="#38bdf8" />
              <Text style={styles.demoExplainTitle}>{activeStep.short}</Text>
            </View>
            {showDetails ? (
              <Text style={styles.demoBannerBody}>{activeStep.detail}</Text>
            ) : null}
            <Text style={styles.demoTapHint}>
              {showDetails ? "Hide" : "Explain"}
            </Text>
          </Pressable>
          <View style={styles.demoButtonRow}>
            <Pressable
              onPress={openNextTourStep}
              style={[styles.demoSmallButton, styles.demoPrimaryButton]}
            >
              <Text style={styles.demoPrimaryButtonText}>
                {nextStep ? activeStep.nextLabel : "Finish tour"}
              </Text>
            </Pressable>
            <Pressable
              onPress={askSampleQuestion}
              style={styles.demoSmallButton}
            >
              <Text style={styles.demoSmallButtonText}>Ask Flo</Text>
            </Pressable>
          </View>
          <View style={styles.demoButtonRow}>
            <Pressable onPress={resetDemo} style={styles.demoSmallButton}>
              <Text style={styles.demoSmallButtonText}>Reset sample</Text>
            </Pressable>
            <Pressable
              onPress={startRealSetup}
              style={[styles.demoSmallButton, styles.demoPrimaryButton]}
            >
              <Text style={styles.demoPrimaryButtonText}>
                Start my real setup
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function GuidedTour() {
  const colors = useColors();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [state, setState] = React.useState(readLearningTourState);
  const [collapsed, setCollapsed] = React.useState(false);
  const [targetRect, setTargetRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const activeStep =
    LEARNING_TOUR_STEPS[state.stepIndex] ?? LEARNING_TOUR_STEPS[0];
  const currentRoute = routeKeyFromSegments(segments.map(String));
  const isOnStepRoute = currentRoute === activeStep.route;

  const closeTour = React.useCallback(() => {
    clearLearningTour();
    setState({ active: false, stepIndex: 0 });
  }, []);

  useBackDismiss(state.active, closeTour);

  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onStart = () => {
      const next = readLearningTourState();
      setState(next);
      const step =
        LEARNING_TOUR_STEPS[next.stepIndex] ?? LEARNING_TOUR_STEPS[0];
      router.push(step.path as any);
    };
    window.addEventListener(LEARNING_TOUR_EVENT, onStart);
    return () => window.removeEventListener(LEARNING_TOUR_EVENT, onStart);
  }, [router]);

  React.useEffect(() => {
    setTargetRect(null);
    if (!state.active || !isOnStepRoute || Platform.OS !== "web" || typeof document === "undefined") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const measure = () => {
      const element = document.getElementById(`guided-tour-${activeStep.route}`);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      }
    };
    [0, 180, 520].forEach(delay => timers.push(setTimeout(measure, delay)));
    window.addEventListener("resize", measure);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", measure);
    };
  }, [activeStep.route, isOnStepRoute, state.active, state.stepIndex, viewportWidth]);

  React.useEffect(() => {
    if (!state.active || isOnStepRoute) return;
    router.push(activeStep.path as any);
  }, [activeStep.path, isOnStepRoute, router, state.active]);

  React.useEffect(() => setCollapsed(false), [state.stepIndex]);

  const goToStep = (stepIndex: number) => {
    const bounded = Math.max(
      0,
      Math.min(LEARNING_TOUR_STEPS.length - 1, stepIndex),
    );
    writeLearningTourState(true, bounded);
    setState({ active: true, stepIndex: bounded });
    router.push(
      (LEARNING_TOUR_STEPS[bounded] ?? LEARNING_TOUR_STEPS[0]).path as any,
    );
  };

  const next = () => {
    if (state.stepIndex >= LEARNING_TOUR_STEPS.length - 1) {
      closeTour();
      return;
    }
    goToStep(state.stepIndex + 1);
  };

  if (!state.active) return null;

  const targetPosition: ViewStyle = targetRect
    ? {
        top: Math.max(4, targetRect.top - 6),
        left: Math.max(4, targetRect.left - 6),
        width: targetRect.width + 12,
        height: targetRect.height + 12,
      }
    : activeStep.route === "index"
      ? { top: "48%", right: 34 }
      : activeStep.route === "monthly"
        ? { top: 176, left: "42%" }
        : activeStep.route === "bills"
          ? { top: 188, right: 24 }
          : { bottom: 116, left: 32 };
  const sheetPosition: ViewStyle = viewportWidth >= 900
    ? { top: insets.top + 18, right: 20, left: "auto" as any, width: 380 }
    : activeStep.route === "flo"
      ? {
          top: Math.max(insets.top + 12, Math.min(150, viewportHeight * 0.2)),
          left: 12,
          right: 12,
        }
      : { bottom: insets.bottom + 92, left: 12, right: 12 };

  return (
    <View pointerEvents="box-none" style={styles.learningLayer}>
      <View
        pointerEvents="none"
        style={[styles.learningTarget, targetPosition]}
      >
        <View style={styles.learningTargetRing} />
        <Feather
          name="mouse-pointer"
          size={24}
          color="#f8fafc"
          style={styles.learningCursor}
        />
        <Text style={styles.learningTargetText}>Tap here</Text>
      </View>
      <View
        style={[
          styles.learningSheet,
          collapsed && styles.learningSheetCollapsed,
          sheetPosition,
          { borderColor: colors.primary + "55" },
        ]}
      >
        <View style={styles.learningHeader}>
          <FloLogo size={36} />
          <View style={{ flex: 1 }}>
            <Text style={styles.learningEyebrow}>
              Guided Tour · {state.stepIndex + 1} of {LEARNING_TOUR_STEPS.length}
            </Text>
            <Text style={styles.learningTitle}>
              {activeStep.title} - {activeStep.focus}
            </Text>
          </View>
          <Pressable
            onPress={() => setCollapsed((value) => !value)}
            style={styles.learningClose}
            hitSlop={8}
            accessibilityLabel={
              collapsed ? "Expand Guided Tour" : "Minimize Guided Tour"
            }
          >
            <Feather
              name={collapsed ? "chevron-down" : "chevron-up"}
              size={18}
              color="#cbd5e1"
            />
          </Pressable>
          <Pressable
            onPress={closeTour}
            style={styles.learningClose}
            hitSlop={8}
            accessibilityLabel="Close Guided Tour"
          >
            <Feather name="x" size={18} color="#cbd5e1" />
          </Pressable>
        </View>

        {!collapsed ? (
          <>
            <Text style={styles.learningBody}>{activeStep.floSays}</Text>
            <View style={styles.learningTryRow}>
              <Feather name="mouse-pointer" size={15} color="#38bdf8" />
              <Text style={styles.learningTryText}>{activeStep.tryThis}</Text>
            </View>
            <View style={styles.learningActions}>
              <Pressable
                onPress={() => goToStep(state.stepIndex - 1)}
                disabled={state.stepIndex === 0}
                style={[
                  styles.learningSecondary,
                  { opacity: state.stepIndex === 0 ? 0.42 : 1 },
                ]}
              >
                <Text style={styles.learningSecondaryText}>Back</Text>
              </Pressable>
              <Pressable
                onPress={next}
                style={[
                  styles.learningPrimary,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.learningPrimaryText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {state.stepIndex >= LEARNING_TOUR_STEPS.length - 1
                    ? "Finish"
                    : "Next"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function TabContent() {
  const { width: viewportWidth } = useWindowDimensions();
  const colors = useColors();
  const router = useRouter();
  const {
    loading,
    loadError,
    retryBudgetLoad,
    demoMode,
    transactions,
    pendingBankTransactions,
    pendingPlanMatches,
    getMonthlyBills,
    getBillOccurrencesInMonth,
    getBillEffectiveMonthlyTotal,
    getPaidAmount,
  } = useBudget();
  const { newFeedbackCount } = useFeedbackBadge();
  const themeMode = useEffectiveThemeMode();
  const isDark = themeMode === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const isDesktop = useDesktopExperience();
  const isIosWeb =
    isWeb &&
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const activityReviewCount = React.useMemo(
    () => buildReviewQueue(transactions, todayIsoDate()).length,
    [transactions],
  );
  const pendingAlertCount = React.useMemo(
    () =>
      unmatchedPendingTransactions(pendingPlanMatches, pendingBankTransactions)
        .length,
    [pendingBankTransactions, pendingPlanMatches],
  );
  const activityAlertCount = activityReviewCount + pendingAlertCount;
  const overdueBillCount = React.useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const protectedOccurrences = pendingOccurrenceKeySet(
      pendingPlanMatches,
      pendingBankTransactions,
    );
    const occurrences = buildOverdueBillOccurrences(
      getMonthlyBills(month, year).map((bill) => ({
        billId: bill.id,
        name: bill.name,
        occurrenceDays: getBillOccurrencesInMonth(bill, month, year),
        plannedTotal: getBillEffectiveMonthlyTotal(bill, month, year),
        paidTotal: getPaidAmount(bill.id, month, year),
      })),
      month,
      year,
      now.getDate(),
    ).filter(
      (occurrence) =>
        !protectedOccurrences.has(
          `${occurrence.billId}:${occurrence.occurrenceDate}`,
        ),
    );
    return groupOverdueBills(occurrences).length;
  }, [
    getBillEffectiveMonthlyTotal,
    getBillOccurrencesInMonth,
    getMonthlyBills,
    getPaidAmount,
    pendingBankTransactions,
    pendingPlanMatches,
  ]);
  const notificationCount = appNotificationCount(
    activityAlertCount,
    overdueBillCount,
    newFeedbackCount,
  );

  React.useEffect(() => {
    void syncAppBadge(notificationCount);
  }, [notificationCount]);

  React.useEffect(
    () => () => {
      void clearAppBadge();
    },
    [],
  );

  return (
    <View
      style={[styles.tabTransitionRoot, { backgroundColor: colors.background }]}
    >
      <View style={styles.tabTransitionContent}>
        <ConnectivityBanner desktop={isDesktop} />
        <AppDiscoveryProvider>
        <ResponsiveDesktopChrome enabled={isDesktop}>
          {loadError ? (
            <BudgetLoadErrorScreen message={loadError} onRetry={retryBudgetLoad} />
          ) : (
          <View style={styles.tabsFrame}>
          <Tabs
            backBehavior="history"
            detachInactiveScreens={false}
            screenOptions={{
              animation: "none",
              freezeOnBlur: !isWeb,
              lazy: true,
              sceneStyle: {
                backgroundColor: colors.background,
              },
              tabBarActiveTintColor: isDark ? "#8b5cf6" : colors.primary,
              tabBarInactiveTintColor: colors.mutedForeground,
              headerShown: false,
              tabBarLabelStyle: {
                fontFamily: "Inter_600SemiBold",
                fontSize: tabBarLabelSize(viewportWidth),
                marginTop: 1,
                width: "100%",
                textAlign: "center",
              },
              tabBarItemStyle: {
                flex: 1,
                flexBasis: 0,
                minWidth: 0,
                paddingVertical: 6,
                borderRadius: 18,
              },
              tabBarIconStyle: {
                width: 28,
                height: 28,
              },
              tabBarStyle: {
                display: isDesktop ? "none" : "flex",
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                backgroundColor: isIOS
                  ? "transparent"
                  : isDark
                    ? "rgba(2,6,23,0.90)"
                    : "rgba(255,255,255,0.96)",
                borderWidth: 1,
                borderTopWidth: 1,
                borderBottomWidth: 0,
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderColor: isDark
                  ? "rgba(148,163,184,0.18)"
                  : "rgba(15,23,42,0.10)",
                shadowColor: isDark ? "#7c3aed" : "#94a3b8",
                shadowOffset: { width: 0, height: 14 },
                shadowOpacity: 0.22,
                shadowRadius: 26,
                elevation: 14,
                paddingHorizontal: 6,
                overflow: "visible",
                ...(isWeb
                  ? {
                      height: isIosWeb ? 72 : 82,
                      paddingTop: isIosWeb ? 6 : 8,
                      paddingBottom: isIosWeb ? 12 : 10,
                    }
                  : {
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
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        backgroundColor: isDark
                          ? "rgba(2,6,23,0.96)"
                          : "rgba(255,255,255,0.96)",
                        borderTopLeftRadius: 28,
                        borderTopRightRadius: 28,
                      },
                    ]}
                  />
                ) : null,
            }}
          >
            {MOBILE_RIBBON_ITEMS.map((tab) => {
              const isAdd = tab.name === "add";
              const isBills = tab.name === "bills";
              const isActivity = tab.name === "transactions";
              const badge = isBills
                ? tabBadgeValue(overdueBillCount)
                : isActivity
                  ? tabBadgeValue(activityAlertCount)
                  : undefined;
              return (
                <Tabs.Screen
                  key={tab.name}
                  name={tab.name}
                  options={{
                    title: tab.title,
                    tabBarLabel: tabBarDisplayLabel(tab.title, viewportWidth),
                    tabBarIcon: isAdd
                      ? undefined
                      : ({ color }) => (
                          <Feather name={tab.icon} size={22} color={color} />
                        ),
                    tabBarButton: isAdd
                      ? () => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Add to FlowLedger"
                            onPress={() =>
                              router.push({
                                pathname: "/(tabs)",
                                params: { add: "1" },
                              } as any)
                            }
                            style={({ pressed }) => [
                              styles.addTabSlot,
                              { opacity: pressed ? 0.78 : 1 },
                            ]}
                          >
                            <View
                              style={[
                                styles.addTabButton,
                                {
                                  backgroundColor: colors.primary,
                                  borderColor: isDark
                                    ? "rgba(196,181,253,0.46)"
                                    : colors.primary,
                                },
                              ]}
                            >
                              <Feather
                                name="plus"
                                size={32}
                                color={colors.primaryForeground}
                              />
                            </View>
                          </Pressable>
                        )
                      : undefined,
                    tabBarBadge: badge,
                    tabBarBadgeStyle: badge ? styles.alertTabBadge : undefined,
                    tabBarAccessibilityLabel: isActivity && badge
                      ? `Activity, ${activityReviewCount} item${activityReviewCount === 1 ? "" : "s"} need review and ${pendingAlertCount} unmatched transaction${pendingAlertCount === 1 ? "" : "s"} pending`
                      : isBills && badge
                        ? `Bills, ${overdueBillCount} past-due bill${overdueBillCount === 1 ? "" : "s"} need action`
                        : tab.title,
                  }}
                />
              );
            })}
            <Tabs.Screen name="accounts" options={{ href: null }} />
            <Tabs.Screen name="more" options={{ href: null }} />
            <Tabs.Screen name="reports" options={{ href: null }} />
            <Tabs.Screen name="review" options={{ href: null }} />
            <Tabs.Screen name="flo" options={{ href: null }} />
            <Tabs.Screen name="category-budget" options={{ href: null }} />
            <Tabs.Screen
              name="zero-budget-lab"
              options={{ href: null, tabBarStyle: { display: "none" } }}
            />
            <Tabs.Screen
              name="how-flowledger-works"
              options={{ href: null, tabBarStyle: { display: "none" } }}
            />
          </Tabs>
          {loading ? <PlanRestoreOverlay isDesktop={isDesktop} /> : null}
          {!loading ? <FloLauncher desktop={isDesktop} /> : null}
          </View>
          )}
        </ResponsiveDesktopChrome>
        </AppDiscoveryProvider>
        {demoMode ? <DemoModeBanner /> : null}
        <PlanPreviewBanner />
        <SaveStatusBanner />
        <DecisionDueModal />
        <GuidedTour />
      </View>
    </View>
  );
}

function ResponsiveDesktopChrome({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  return (
    <React.Suspense
      fallback={
        <View style={styles.loadingScreen}>
          <Image
            source={require("../../assets/images/startup_f_transparent.png")}
            style={styles.loadingLogo}
            resizeMode="contain"
          />
          <Text style={styles.desktopLoadingText}>
            Opening desktop workspace...
          </Text>
        </View>
      }
    >
      <DesktopChrome>{children}</DesktopChrome>
    </React.Suspense>
  );
}

export default function TabLayout() {
  return (
    <FeedbackBadgeProvider>
      <TabContent />
    </FeedbackBadgeProvider>
  );
}

const styles = StyleSheet.create({
  tabTransitionRoot: {
    flex: 1,
    backgroundColor: "#050816",
  },
  tabTransitionContent: {
    flex: 1,
  },
  tabsFrame: {
    flex: 1,
    minWidth: 0,
  },
  alertTabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
    lineHeight: 18,
  },
  addTabSlot: {
    flex: 1,
    flexBasis: 0,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  addTabButton: {
    width: 66,
    height: 66,
    marginTop: -23,
    borderRadius: 33,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c3aed",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.48,
    shadowRadius: 20,
    elevation: 18,
  },
  planRestoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    padding: 28,
  },
  planRestoreOverlayMobile: {
    bottom: 86,
    paddingHorizontal: 18,
    paddingTop: 24,
  },
  planRestoreHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  planRestoreLabel: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  skeletonTitle: { width: 190, height: 28, borderRadius: 9, opacity: 0.7 },
  skeletonAction: { width: 112, height: 42, borderRadius: 14, opacity: 0.55 },
  skeletonGrid: { flexDirection: "row", gap: 14, marginTop: 24 },
  skeletonGridMobile: { flexWrap: "wrap", gap: 10, marginTop: 18 },
  skeletonCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    justifyContent: "center",
    gap: 14,
  },
  skeletonCardMobile: { flexBasis: "46%", minHeight: 112, padding: 14 },
  skeletonLineShort: { width: "44%", height: 12, borderRadius: 6, opacity: 0.6 },
  skeletonLine: { width: "72%", height: 22, borderRadius: 7, opacity: 0.7 },
  skeletonPanel: {
    flex: 1,
    minHeight: 220,
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    opacity: 0.72,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050816",
  },
  loadingLogo: {
    width: 118,
    height: 118,
    borderRadius: 30,
    marginBottom: 14,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  desktopLoadingText: {
    color: "#94a3b8",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
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
  learningLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 110,
  },
  learningTarget: {
    position: "absolute",
    width: 66,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 111,
  },
  learningTargetRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: "#38bdf8",
    backgroundColor: "rgba(56,189,248,0.14)",
    shadowColor: "#38bdf8",
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 12,
  },
  learningCursor: {
    position: "absolute",
    top: 34,
    right: 2,
    textShadowColor: "#020617",
    textShadowRadius: 5,
  },
  learningTargetText: {
    position: "absolute",
    bottom: -24,
    color: "#e0f2fe",
    backgroundColor: "rgba(2,6,23,0.88)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: "900",
  },
  learningSheet: {
    position: "absolute",
    left: 12,
    right: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 11,
    backgroundColor: "rgba(15,23,42,0.96)",
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.24,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  learningSheetCollapsed: { left: 58 },
  learningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  learningEyebrow: {
    color: "#a78bfa",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  learningTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },
  learningClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.12)",
  },
  learningBody: {
    color: "#f8fafc",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 8,
  },
  learningTryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 8,
    padding: 8,
    borderRadius: 12,
    backgroundColor: "rgba(56,189,248,0.10)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.22)",
  },
  learningTryText: {
    flex: 1,
    color: "#bae6fd",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  learningActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  learningSecondary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    backgroundColor: "rgba(15,23,42,0.72)",
  },
  learningSecondaryText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "900",
  },
  learningPrimary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  learningPrimaryText: {
    fontSize: 14,
    fontWeight: "900",
  },
});

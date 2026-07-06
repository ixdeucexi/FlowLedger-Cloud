import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs, useRouter, useSegments } from "expo-router";
import React from "react";
import { Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, StyleProp, Text, View, ViewStyle } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { DecisionDueModal } from "@/components/DecisionDueModal";
import { FloLogo } from "@/components/FloLogo";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useEffectiveThemeMode } from "@/hooks/useEffectiveThemeMode";
import {
  clearLearningTour,
  LEARNING_TOUR_EVENT,
  LEARNING_TOUR_STEPS,
  readLearningTourState,
  writeLearningTourState,
} from "@/lib/learningTour";
import { clearStoredSetupStep } from "@/lib/setupProgress";

const MIN_BUDGET_LOADING_MS = 220;

const TABS = [
  { name: "index",        title: "Dashboard",    icon: "bar-chart-2"     },
  { name: "bills",        title: "Bills",        icon: "file-text"       },
  { name: "flo",          title: "Flo",          icon: "message-circle"  },
  { name: "transactions", title: "Activity",     icon: "repeat"          },
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
    nextLabel: "Open Activity",
    short: "This is where obligations are set up.",
    detail: "Bills holds recurring bills and debts. This is where a user manages due dates, minimum payments, snowball settings, and recurring obligations.",
  },
  {
    route: "transactions",
    title: "Activity",
    path: "/(tabs)/transactions",
    nextLabel: "Open Flo",
    short: "This is what actually happened.",
    detail: "Activity is the log of what actually happened. It shows spending, income, transfers, debt payments, and anything imported or manually added so the forecast can stay honest.",
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

function BudgetLoadingScreen({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const colors = useColors();
  return (
    <Animated.View style={[styles.loadingScreen, { backgroundColor: colors.background }, style]}>
      <Image
        source={require("../../assets/images/startup_f_transparent.png")}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <Text style={[styles.loadingTitle, { color: colors.foreground }]}>FlowLedger Algo</Text>
      <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>Opening your plan...</Text>
    </Animated.View>
  );
}

function BudgetLoadErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
      <Image
        source={require("../../assets/images/startup_f_transparent.png")}
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
  if (routeName === "transactions") return "Activity is the transaction trail. These are fake entries so you can explore safely.";
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

function FloLearningTour() {
  const colors = useColors();
  const router = useRouter();
  const segments = useSegments();
  const [state, setState] = React.useState(readLearningTourState);
  const activeStep = LEARNING_TOUR_STEPS[state.stepIndex] ?? LEARNING_TOUR_STEPS[0];
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
      const step = LEARNING_TOUR_STEPS[next.stepIndex] ?? LEARNING_TOUR_STEPS[0];
      router.push(step.path as any);
    };
    window.addEventListener(LEARNING_TOUR_EVENT, onStart);
    return () => window.removeEventListener(LEARNING_TOUR_EVENT, onStart);
  }, [router]);

  React.useEffect(() => {
    if (!state.active || isOnStepRoute) return;
    router.push(activeStep.path as any);
  }, [activeStep.path, isOnStepRoute, router, state.active]);

  const goToStep = (stepIndex: number) => {
    const bounded = Math.max(0, Math.min(LEARNING_TOUR_STEPS.length - 1, stepIndex));
    writeLearningTourState(true, bounded);
    setState({ active: true, stepIndex: bounded });
    router.push((LEARNING_TOUR_STEPS[bounded] ?? LEARNING_TOUR_STEPS[0]).path as any);
  };

  const next = () => {
    if (state.stepIndex >= LEARNING_TOUR_STEPS.length - 1) {
      closeTour();
      return;
    }
    goToStep(state.stepIndex + 1);
  };

  if (!state.active) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeTour}>
      <View style={styles.learningBackdrop}>
        <Pressable style={styles.learningDismissZone} onPress={closeTour} />
        <View style={[styles.learningSheet, { borderColor: colors.primary + "55" }]}>
          <View style={styles.learningHeader}>
            <FloLogo size={58} />
            <View style={{ flex: 1 }}>
              <Text style={styles.learningEyebrow}>Flo learning mode</Text>
              <Text style={styles.learningTitle}>{activeStep.title}</Text>
            </View>
            <Pressable onPress={closeTour} style={styles.learningClose} hitSlop={8}>
              <Feather name="x" size={18} color="#cbd5e1" />
            </Pressable>
          </View>

          <View style={styles.learningFocusPill}>
            <Feather name="crosshair" size={15} color="#38bdf8" />
            <Text style={styles.learningFocusText}>{activeStep.focus}</Text>
          </View>

          <Text style={styles.learningBody}>{activeStep.floSays}</Text>
          <Text style={styles.learningTry}>{activeStep.tryThis}</Text>

          <View style={styles.learningDots}>
            {LEARNING_TOUR_STEPS.map((step, index) => (
              <Pressable
                key={step.route}
                onPress={() => goToStep(index)}
                style={[
                  styles.learningDot,
                  index === state.stepIndex && styles.learningDotActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.learningActions}>
            <Pressable
              onPress={() => goToStep(state.stepIndex - 1)}
              disabled={state.stepIndex === 0}
              style={[styles.learningSecondary, { opacity: state.stepIndex === 0 ? 0.42 : 1 }]}
            >
              <Text style={styles.learningSecondaryText}>Back</Text>
            </Pressable>
            <Pressable onPress={next} style={[styles.learningPrimary, { backgroundColor: colors.primary }]}>
              <Text style={[styles.learningPrimaryText, { color: colors.primaryForeground }]}>
                {state.stepIndex >= LEARNING_TOUR_STEPS.length - 1 ? "Finish" : "Next"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TabContent() {
  const colors = useColors();
  const { loading, loadError, retryBudgetLoad, demoMode } = useBudget();
  const [minimumBudgetLoadingReady, setMinimumBudgetLoadingReady] = React.useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = React.useState(true);
  const loadingOpacity = React.useRef(new Animated.Value(1)).current;
  const tabsOpacity = React.useRef(new Animated.Value(0)).current;
  const themeMode = useEffectiveThemeMode();
  const isDark = themeMode === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const isIosWeb = isWeb && typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  React.useEffect(() => {
    const t = setTimeout(() => setMinimumBudgetLoadingReady(true), MIN_BUDGET_LOADING_MS);
    return () => clearTimeout(t);
  }, []);

  const contentReady = !loading && minimumBudgetLoadingReady;

  React.useEffect(() => {
    if (!contentReady) {
      loadingOpacity.setValue(1);
      tabsOpacity.setValue(0);
      setShowLoadingOverlay(true);
      return;
    }

    setShowLoadingOverlay(true);
    Animated.parallel([
      Animated.timing(loadingOpacity, {
        toValue: 0,
        duration: 360,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(tabsOpacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setShowLoadingOverlay(false));
  }, [contentReady, loadingOpacity, tabsOpacity]);

  if (!contentReady) return <BudgetLoadingScreen />;
  if (loadError) return <BudgetLoadErrorScreen message={loadError} onRetry={retryBudgetLoad} />;

  return (
    <View style={[styles.tabTransitionRoot, { backgroundColor: colors.background }]}>
      <Animated.View style={[styles.tabTransitionContent, { opacity: tabsOpacity }]}>
        <Tabs
          backBehavior="history"
          detachInactiveScreens={false}
          screenOptions={{
            animation: "none",
            freezeOnBlur: !isWeb,
            lazy: true,
            tabBarActiveTintColor: isDark ? "#8b5cf6" : colors.primary,
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
              backgroundColor: isIOS ? "transparent" : isDark ? "rgba(2,6,23,0.90)" : "rgba(255,255,255,0.96)",
              borderWidth: 1,
              borderTopWidth: 1,
              borderBottomWidth: 0,
              borderLeftWidth: 0,
              borderRightWidth: 0,
              borderColor: isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.10)",
              shadowColor: isDark ? "#7c3aed" : "#94a3b8",
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
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: isDark ? "rgba(2,6,23,0.96)" : "rgba(255,255,255,0.96)",
                      borderTopLeftRadius: 28,
                      borderTopRightRadius: 28,
                    },
                  ]}
                />
              ) : null,
          }}
        >
          {TABS.map(tab => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.title,
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
        <FloLearningTour />
      </Animated.View>
      {showLoadingOverlay ? (
        <BudgetLoadingScreen style={[styles.loadingOverlay, { opacity: loadingOpacity }]} />
      ) : null}
    </View>
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
  tabTransitionRoot: {
    flex: 1,
    backgroundColor: "#050816",
  },
  tabTransitionContent: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
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
  loadingTitle: {
    fontSize: 20,
    fontWeight: "800",
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
  learningBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.34)",
    padding: 14,
  },
  learningDismissZone: {
    ...StyleSheet.absoluteFillObject,
  },
  learningSheet: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 18,
    marginBottom: 78,
    backgroundColor: "rgba(15,23,42,0.88)",
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.24,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  learningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  learningEyebrow: {
    color: "#a78bfa",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  learningTitle: {
    color: "#f8fafc",
    fontSize: 24,
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
  learningFocusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "rgba(56,189,248,0.14)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.24)",
    marginTop: 16,
  },
  learningFocusText: {
    color: "#bae6fd",
    fontSize: 12,
    fontWeight: "900",
  },
  learningBody: {
    color: "#f8fafc",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
    marginTop: 14,
  },
  learningTry: {
    color: "#c4b5fd",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 10,
  },
  learningDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    marginTop: 16,
  },
  learningDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.35)",
  },
  learningDotActive: {
    width: 24,
    backgroundColor: "#8b5cf6",
  },
  learningActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  learningSecondary: {
    flex: 1,
    minHeight: 48,
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
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  learningPrimaryText: {
    fontSize: 14,
    fontWeight: "900",
  },
});

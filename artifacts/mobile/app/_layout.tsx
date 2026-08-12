import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Image, Platform, StyleSheet, StyleProp, Text, View, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FloLauncher } from "@/components/FloLauncher";
import { BiometricLockGate } from "@/components/BiometricLockGate";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { LegalAcceptanceGate } from "@/components/LegalAcceptanceGate";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PlaidOAuthResume } from "@/components/PlaidOAuthResume";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BiometricLockProvider, useBiometricLock } from "@/context/BiometricLockContext";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { MembershipProvider } from "@/context/MembershipContext";
import { ThemeProvider, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { readLastAppRoute, rememberAppRoute } from "@/lib/navigationMemory";
import { WEB_VIEWPORT_CONTENT } from "@/lib/webViewport";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const PLAN_LOADING_MS = 220;

function AuthObserver() {
  const { session, loading } = useAuth();
  const { activeHousehold, loading: budgetLoading, settings } = useBudget();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<Record<string, string | string[]>>();
  const restoreAttemptRef = useRef<string | null>(null);

  const currentRoute = React.useMemo(() => {
    const query = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, rawValue]) => {
      const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
      if (typeof value === "string" && value.length > 0) query.set(key, value);
    });
    const serialized = query.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (loading || (session && budgetLoading)) return;
    const firstSegment = segments[0] as string | undefined;
    const inAuth = firstSegment === "login";
    const isPublicLegal = firstSegment === "legal";
    const atRoot = !firstSegment || firstSegment === "index";

    const replaceRoute = (destination: string) => {
      router.replace(destination as any);
    };

    const householdId = activeHousehold?.householdId ?? `personal-${session?.user.id ?? "signed-out"}`;

    if (!session && !inAuth && !isPublicLegal) {
      replaceRoute("/login");
    } else if (session && (inAuth || atRoot)) {
      let requestedSetup = false;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          requestedSetup = window.localStorage.getItem("flowledger_show_setup_after_login") === "true";
          if (requestedSetup) window.localStorage.removeItem("flowledger_show_setup_after_login");
        } catch {}
      }
      if (!requestedSetup && settings.onboarding_completed) {
        const restoreKey = `${session.user.id}:${householdId}`;
        if (restoreAttemptRef.current === restoreKey) return;
        restoreAttemptRef.current = restoreKey;
        let cancelled = false;
        void readLastAppRoute(session.user.id, householdId).then(destination => {
          if (!cancelled) replaceRoute(destination ?? "/(tabs)");
        });
        return () => {
          cancelled = true;
        };
      }
      replaceRoute(settings.onboarding_completed ? "/(tabs)" : "/setup");
      return;
    }

    if (session && !inAuth && !atRoot && !isPublicLegal) {
      restoreAttemptRef.current = null;
      void rememberAppRoute(session.user.id, householdId, currentRoute);
    }
  }, [activeHousehold?.householdId, budgetLoading, currentRoute, loading, router, segments, session, settings.onboarding_completed]);

  useEffect(() => {
    if (loading || budgetLoading || !session || Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const householdId = activeHousehold?.householdId ?? `personal-${session.user.id}`;
    const rememberRouteBeforePause = () => void rememberAppRoute(session.user.id, householdId, currentRoute);
    const rememberRouteWhenHidden = () => {
      if (document.visibilityState === "hidden") rememberRouteBeforePause();
    };

    window.addEventListener("pagehide", rememberRouteBeforePause);
    document.addEventListener("visibilitychange", rememberRouteWhenHidden);

    return () => {
      window.removeEventListener("pagehide", rememberRouteBeforePause);
      document.removeEventListener("visibilitychange", rememberRouteWhenHidden);
    };
  }, [activeHousehold?.householdId, budgetLoading, currentRoute, loading, session]);

  return null;
}

function StartupScreen({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const colors = useColors();
  return (
    <Animated.View style={[styles.startup, { backgroundColor: colors.background }, style]}>
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel="FlowLedger"
        source={require("../assets/images/startup_f_transparent.png")}
        style={styles.startupIcon}
        resizeMode="contain"
      />
      <Text style={[styles.startupStatus, { color: colors.mutedForeground }]}>Loading Plan...</Text>
    </Animated.View>
  );
}

function RootNavigator({ fontsReady, hideSplash }: { fontsReady: boolean; hideSplash: () => void }) {
  const colors = useColors();
  const { loading: authLoading } = useAuth();
  const { ready: biometricLockReady, locked: biometricLocked } = useBiometricLock();
  const { ready: themeReady } = useThemeMode();
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useDesktopExperience();
  const [minimumStartupReady, setMinimumStartupReady] = useState(false);
  const [showStartupOverlay, setShowStartupOverlay] = useState(true);
  const startupOpacity = useRef(new Animated.Value(1)).current;
  const appOpacity = useRef(new Animated.Value(0)).current;
  const coreReady = fontsReady && !authLoading && biometricLockReady && themeReady;
  const appReady = coreReady && minimumStartupReady;

  useEffect(() => {
    if (!coreReady || biometricLocked) return;
    const t = setTimeout(() => setMinimumStartupReady(true), PLAN_LOADING_MS);
    return () => clearTimeout(t);
  }, [biometricLocked, coreReady]);

  useEffect(() => {
    if (coreReady) hideSplash();
  }, [coreReady, hideSplash]);

  useEffect(() => {
    if (!appReady) {
      startupOpacity.setValue(1);
      appOpacity.setValue(0);
      setShowStartupOverlay(true);
      return;
    }

    hideSplash();
    if (reduceMotion) {
      startupOpacity.setValue(0);
      appOpacity.setValue(1);
      setShowStartupOverlay(false);
      return;
    }
    setShowStartupOverlay(true);
    Animated.parallel([
      Animated.timing(startupOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(appOpacity, {
        toValue: 1,
        duration: 160,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start(() => setShowStartupOverlay(false));
  }, [appReady, appOpacity, hideSplash, reduceMotion, startupOpacity]);

  useEffect(() => {
    if (!appReady || Platform.OS === "web") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (router.canGoBack()) {
        router.back();
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [appReady, router]);

  return (
    <View style={[styles.transitionRoot, { backgroundColor: colors.background }]}>
      <Animated.View
        accessibilityElementsHidden={biometricLocked}
        importantForAccessibility={biometricLocked ? "no-hide-descendants" : "auto"}
        style={[styles.transitionContent, { opacity: appOpacity }]}
      >
        {appReady ? (
          <>
            <AuthObserver />
            <GestureHandlerRootView style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="legal" />
                <Stack.Screen name="setup" />
                <Stack.Screen
                  name="snowball-plan"
                  options={{
                    animation: "slide_from_right",
                    animationTypeForReplace: "pop",
                    presentation: "card",
                  }}
                />
                <Stack.Screen
                  name="planned-debt-payment"
                  options={{
                    animation: "slide_from_right",
                    animationTypeForReplace: "pop",
                    presentation: "card",
                  }}
                />
                <Stack.Screen
                  name="plan-simulator"
                  options={{
                    animation: "slide_from_right",
                    animationTypeForReplace: "pop",
                    presentation: "card",
                  }}
                />
                <Stack.Screen name="(tabs)" />
              </Stack>
              <PwaInstallPrompt />
              <PlaidOAuthResume />
              <ConfirmActionModal />
              {!biometricLocked && ["/snowball-plan", "/planned-debt-payment", "/plan-simulator"].includes(pathname) ? <FloLauncher desktop={isDesktop} /> : null}
            </GestureHandlerRootView>
            <LegalAcceptanceGate />
          </>
        ) : null}
      </Animated.View>
      {showStartupOverlay ? (
        <StartupScreen style={[styles.startupOverlay, { opacity: startupOpacity }]} />
      ) : null}
      {coreReady ? <BiometricLockGate /> : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...Feather.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const fontsReady = fontsLoaded || !!fontError;

  const hiddenRef = useRef(false);
  const hideSplash = useCallback(() => {
    if (hiddenRef.current) return;
    hiddenRef.current = true;
    SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    let viewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.name = "viewport";
      document.head.appendChild(viewport);
    }

    viewport.setAttribute("content", WEB_VIEWPORT_CONTENT);
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BiometricLockProvider>
                <BudgetProvider>
                  <MembershipProvider>
                    <RootNavigator fontsReady={fontsReady} hideSplash={hideSplash} />
                  </MembershipProvider>
                </BudgetProvider>
              </BiometricLockProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  transitionRoot: {
    flex: 1,
    backgroundColor: "#050816",
  },
  transitionContent: {
    flex: 1,
  },
  startupOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  startup: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050816",
  },
  startupIcon: {
    width: 118,
    height: 118,
    borderRadius: 30,
    marginBottom: 14,
    shadowColor: "#38bdf8",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  startupStatus: {
    marginTop: 2,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.2,
  },
});

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
import { Animated, AppState, BackHandler, Easing, Image, Platform, StyleSheet, StyleProp, View, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FloLauncher } from "@/components/FloLauncher";
import { BiometricLockGate } from "@/components/BiometricLockGate";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { LegalAcceptanceGate } from "@/components/LegalAcceptanceGate";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PlaidOAuthResume } from "@/components/PlaidOAuthResume";
import { StartupPlanBrand } from "@/components/StartupPlanBrand";
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
const STARTUP_BRAND_FADE_MS = 1200;
const STARTUP_BRAND_HOLD_MS = 300;
const APP_REVEAL_MS = 700;

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
    const isAuthCallback = firstSegment === "auth";
    const isPasswordReset = isAuthCallback && String(segments[1] ?? "") === "reset-password";
    const isPublicLegal = firstSegment === "legal";
    const isPublicSupport = firstSegment === "support";
    const isPublicDeletionRequest = firstSegment === "delete-account";
    const atRoot = !firstSegment || firstSegment === "index";

    const replaceRoute = (destination: string) => {
      router.replace(destination as any);
    };

    const householdId = activeHousehold?.householdId ?? `personal-${session?.user.id ?? "signed-out"}`;

    if (!session && !inAuth && !isPublicLegal && !isPublicSupport && !isPublicDeletionRequest && !isAuthCallback) {
      replaceRoute("/login");
    } else if (session && (inAuth || (isAuthCallback && !isPasswordReset) || atRoot)) {
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

    if (session && !inAuth && !isAuthCallback && !atRoot && !isPublicLegal && !isPublicSupport && !isPublicDeletionRequest) {
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

function StartupScreen({
  style,
  brandOpacity,
  brandEntranceStarted,
  leaving,
  reduceMotion,
}: {
  style?: StyleProp<ViewStyle>;
  brandOpacity: Animated.Value;
  brandEntranceStarted: boolean;
  leaving: boolean;
  reduceMotion: boolean;
}) {
  const webOverlayTransition = Platform.OS === "web" && !reduceMotion
    ? ({
        opacity: leaving ? 0 : 1,
        transitionDuration: `${APP_REVEAL_MS}ms`,
        transitionProperty: "opacity",
        transitionTimingFunction: "ease-in-out",
      } as ViewStyle)
    : undefined;
  const webBrandTransition = Platform.OS === "web"
    ? ({
        opacity: brandEntranceStarted || reduceMotion ? 1 : 0,
        transitionDuration: reduceMotion ? "0ms" : `${STARTUP_BRAND_FADE_MS}ms`,
        transitionProperty: "opacity",
        transitionTimingFunction: "ease-in-out",
      } as ViewStyle)
    : { opacity: brandOpacity };

  return (
    <Animated.View style={[styles.startup, style, webOverlayTransition]}>
      <Animated.View style={[styles.startupBrand, webBrandTransition]}>
        <StartupPlanBrand />
      </Animated.View>
    </Animated.View>
  );
}

function RootNavigator({ fontsReady, hideSplash }: { fontsReady: boolean; hideSplash: () => Promise<void> }) {
  const colors = useColors();
  const { session, loading: authLoading } = useAuth();
  const { loading: budgetLoading } = useBudget();
  const { ready: biometricLockReady, locked: biometricLocked } = useBiometricLock();
  const { ready: themeReady } = useThemeMode();
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useDesktopExperience();
  const [minimumStartupReady, setMinimumStartupReady] = useState(false);
  const [brandEntranceStarted, setBrandEntranceStarted] = useState(false);
  const [brandEntranceReady, setBrandEntranceReady] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [showStartupOverlay, setShowStartupOverlay] = useState(true);
  const [webExitStarted, setWebExitStarted] = useState(false);
  const [privacyShielded, setPrivacyShielded] = useState(Platform.OS !== "web" && AppState.currentState !== "active");
  const brandEntranceStartedRef = useRef(false);
  const brandEntranceOpacity = useRef(new Animated.Value(0)).current;
  const startupOpacity = useRef(new Animated.Value(1)).current;
  const appOpacity = useRef(new Animated.Value(0)).current;
  const coreReady = fontsReady && !authLoading && biometricLockReady && themeReady;
  const planReady = !session || !budgetLoading;
  const initialAppReady = coreReady && planReady && minimumStartupReady && brandEntranceReady;

  useEffect(() => {
    if (Platform.OS === "web") return;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener("change", state => {
      if (revealTimer) clearTimeout(revealTimer);
      if (state === "active") {
        revealTimer = setTimeout(() => setPrivacyShielded(false), 120);
      } else {
        setPrivacyShielded(true);
      }
    });
    return () => {
      if (revealTimer) clearTimeout(revealTimer);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (initialAppReady) setAppReady(true);
  }, [initialAppReady]);

  useEffect(() => {
    if (!coreReady || biometricLocked) return;
    const t = setTimeout(() => setMinimumStartupReady(true), PLAN_LOADING_MS);
    return () => clearTimeout(t);
  }, [biometricLocked, coreReady]);

  useEffect(() => {
    if (!coreReady) return;

    let active = true;
    void hideSplash().then(() => {
      if (!active) return;

      if (reduceMotion) {
        brandEntranceOpacity.stopAnimation();
        brandEntranceOpacity.setValue(1);
        brandEntranceStartedRef.current = true;
        setBrandEntranceStarted(true);
        setBrandEntranceReady(true);
        return;
      }

      if (brandEntranceStartedRef.current) return;
      brandEntranceStartedRef.current = true;
      setBrandEntranceStarted(true);

      if (Platform.OS === "web") {
        return;
      }

      Animated.sequence([
        Animated.timing(brandEntranceOpacity, {
          toValue: 1,
          duration: STARTUP_BRAND_FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(STARTUP_BRAND_HOLD_MS),
      ]).start(({ finished }) => {
        if (active && finished) setBrandEntranceReady(true);
      });
    });

    return () => {
      active = false;
    };
  }, [brandEntranceOpacity, coreReady, hideSplash, reduceMotion]);

  useEffect(() => {
    if (
      Platform.OS !== "web"
      || !brandEntranceStarted
      || brandEntranceReady
      || reduceMotion
    ) return;

    const webEntranceTimer = setTimeout(
      () => setBrandEntranceReady(true),
      STARTUP_BRAND_FADE_MS + STARTUP_BRAND_HOLD_MS,
    );
    return () => clearTimeout(webEntranceTimer);
  }, [brandEntranceReady, brandEntranceStarted, reduceMotion]);

  useEffect(() => {
    if (!appReady) {
      startupOpacity.setValue(1);
      appOpacity.setValue(0);
      setWebExitStarted(false);
      setShowStartupOverlay(true);
      return;
    }

    if (reduceMotion) {
      startupOpacity.setValue(0);
      appOpacity.setValue(1);
      setShowStartupOverlay(false);
      return;
    }

    if (Platform.OS === "web") {
      startupOpacity.setValue(1);
      appOpacity.setValue(1);
      setShowStartupOverlay(true);
      let secondFrame: number | undefined;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setWebExitStarted(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
      };
    }

    setShowStartupOverlay(true);
    Animated.parallel([
      Animated.timing(startupOpacity, {
        toValue: 0,
        duration: APP_REVEAL_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(appOpacity, {
        toValue: 1,
        duration: APP_REVEAL_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setShowStartupOverlay(false));
  }, [appReady, appOpacity, reduceMotion, startupOpacity]);

  useEffect(() => {
    if (Platform.OS !== "web" || !appReady || !webExitStarted || reduceMotion) return;

    const webExitTimer = setTimeout(
      () => setShowStartupOverlay(false),
      APP_REVEAL_MS + 80,
    );
    return () => clearTimeout(webExitTimer);
  }, [appReady, reduceMotion, webExitStarted]);

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
                <Stack.Screen name="auth/callback" />
                <Stack.Screen name="auth/reset-password" />
                <Stack.Screen name="legal" />
                <Stack.Screen name="support" />
                <Stack.Screen name="delete-account" />
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
                <Stack.Screen
                  name="user-guide"
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
        <StartupScreen
          brandOpacity={brandEntranceOpacity}
          brandEntranceStarted={brandEntranceStarted}
          leaving={webExitStarted}
          reduceMotion={reduceMotion}
          style={[styles.startupOverlay, Platform.OS === "web" ? undefined : { opacity: startupOpacity }]}
        />
      ) : null}
      {coreReady ? <BiometricLockGate /> : null}
      {privacyShielded ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.privacyShield, { backgroundColor: colors.background }]}
        >
          <Image source={require("../assets/images/startup_f_transparent.png")} resizeMode="contain" style={styles.privacyShieldLogo} />
        </View>
      ) : null}
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

  const hideSplashPromiseRef = useRef<Promise<void> | null>(null);
  const hideSplash = useCallback(() => {
    if (!hideSplashPromiseRef.current) {
      hideSplashPromiseRef.current = SplashScreen.hideAsync()
        .then(() => undefined)
        .catch(() => undefined);
    }
    return hideSplashPromiseRef.current;
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
  startupBrand: {
    alignItems: "center",
    flexShrink: 0,
  },
  privacyShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyShieldLogo: {
    width: 160,
    height: 160,
  },
});

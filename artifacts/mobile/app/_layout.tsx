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
import { Alert, AppState, BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FloLauncher } from "@/components/FloLauncher";
import { BiometricLockGate } from "@/components/BiometricLockGate";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { LegalAcceptanceGate } from "@/components/LegalAcceptanceGate";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PlaidOAuthResume } from "@/components/PlaidOAuthResume";
import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BiometricLockProvider, useBiometricLock } from "@/context/BiometricLockContext";
import { BudgetProvider, useBudget } from "@/context/BudgetContext";
import { MembershipProvider } from "@/context/MembershipContext";
import { ThemeProvider, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { NetworkStatusProvider } from "@/hooks/useNetworkStatus";
import { readLastAppRoute, rememberAppRoute } from "@/lib/navigationMemory";
import { WEB_VIEWPORT_CONTENT } from "@/lib/webViewport";
import {
  configureNativeNotificationPresentation,
  getInitialNotificationRoute,
  restorePushNotifications,
  subscribeToNotificationRoutes,
  subscribeToPushTokenRotation,
} from "@/lib/pushNotifications";
import { notificationHouseholdAction, type NativeNotificationDestination } from "@/lib/nativeNotificationRoute";
import { verifyCurrentHouseholdMembership } from "@/lib/households";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

const queryClient = new QueryClient();
const PRIVACY_REFRESH_TIMEOUT_MS = 10_000;
const SHARED_HOUSEHOLD_PRIVACY_TTL_MS = 5 * 60 * 1000;

function withStartupTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function AuthObserver() {
  const { session, loading } = useAuth();
  const { activeHousehold, households, loading: budgetLoading, settings, switchHousehold } = useBudget();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<Record<string, string | string[]>>();
  const restoreAttemptRef = useRef<string | null>(null);
  const notificationInitialRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    configureNativeNotificationPresentation();
    if (loading || budgetLoading || !session) return;
    const openRoute = async (destination: NativeNotificationDestination) => {
      try {
        if (destination.householdId && !await verifyCurrentHouseholdMembership(session.user.id, destination.householdId)) {
          throw new Error("HOUSEHOLD_UNAVAILABLE");
        }
        const action = notificationHouseholdAction(
          activeHousehold?.householdId ?? null,
          households.map(household => household.householdId),
          destination.householdId,
        );
        if (action === "reject") throw new Error("HOUSEHOLD_UNAVAILABLE");
        if (action === "switch" && destination.householdId) await switchHousehold(destination.householdId);
        router.push(destination.route as any);
      } catch {
        Alert.alert("Notification unavailable", "You no longer have access to the household for this notification.");
      }
    };
    if (notificationInitialRef.current !== session.user.id) {
      notificationInitialRef.current = session.user.id;
      void getInitialNotificationRoute().then(destination => { if (destination) void openRoute(destination); });
    }
    const unsubscribe = subscribeToNotificationRoutes(destination => { void openRoute(destination); });
    return unsubscribe;
  }, [activeHousehold?.householdId, budgetLoading, households, loading, router, session?.user.id, switchHousehold]);

  useEffect(() => {
    if (Platform.OS === "web" || loading || budgetLoading || !session?.access_token || !activeHousehold?.householdId) return;
    const reportFailure = (error: unknown) => {
      console.warn("Native notification registration needs attention.", error);
    };
    void restorePushNotifications(session.access_token, session.user.id, activeHousehold.householdId).catch(reportFailure);
    return subscribeToPushTokenRotation(session.access_token, session.user.id, activeHousehold.householdId, reportFailure);
  }, [activeHousehold?.householdId, budgetLoading, loading, session]);

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
        void withStartupTimeout(
          readLastAppRoute(session.user.id, householdId),
          1_500,
          "Restore last screen",
        ).catch(() => null).then(destination => {
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

function RootNavigator({ fontsReady, hideSplash }: { fontsReady: boolean; hideSplash: () => Promise<void> }) {
  const colors = useColors();
  const { session, loading: authLoading } = useAuth();
  const { activeHousehold, loading: budgetLoading, refreshHouseholdsForPrivacy } = useBudget();
  const { ready: biometricLockReady, locked: biometricLocked } = useBiometricLock();
  const { ready: themeReady } = useThemeMode();
  const router = useRouter();
  const pathname = usePathname();
  const rootSegments = useSegments();
  const isDesktop = useDesktopExperience();
  const [appReady, setAppReady] = useState(false);
  const [privacyShielded, setPrivacyShielded] = useState(Platform.OS !== "web" && AppState.currentState !== "active");
  const [privacyRefreshError, setPrivacyRefreshError] = useState<string | null>(null);
  const [privacyRefreshRetry, setPrivacyRefreshRetry] = useState(0);
  const privacyRefreshGenerationRef = useRef(0);
  const previousAppStateRef = useRef(AppState.currentState);
  const hasRevealedPlanRef = useRef(false);
  const verifiedPrivacyScopeRef = useRef<string | null>(null);
  const lastPrivacyVerificationAtRef = useRef(0);
  const privacyScopeRef = useRef({
    userId: session?.user.id ?? null,
    householdId: activeHousehold?.householdId ?? null,
    isPersonal: activeHousehold?.isPersonal ?? true,
  });
  const privacyRefreshRef = useRef(refreshHouseholdsForPrivacy);
  privacyScopeRef.current = {
    userId: session?.user.id ?? null,
    householdId: activeHousehold?.householdId ?? null,
    isPersonal: activeHousehold?.isPersonal ?? true,
  };
  privacyRefreshRef.current = refreshHouseholdsForPrivacy;
  const coreReady = fontsReady && !authLoading && biometricLockReady && themeReady;
  // The native splash must never wait on network data. Render the app-owned
  // loading route as soon as fonts/auth/lock/theme are ready, then let routing
  // and plan restoration finish behind one constant FlowLedger screen.
  const initialAppReady = coreReady;
  const firstRootSegment = rootSegments[0] as string | undefined;
  const secondRootSegment = rootSegments[1] as string | undefined;
  const onPlaceholderRoute = !firstRootSegment || firstRootSegment === "index";
  const onPendingAuthRoute = firstRootSegment === "login"
    || (firstRootSegment === "auth" && secondRootSegment !== "reset-password");
  const navigationReady = appReady && (session
    ? !onPlaceholderRoute && !onPendingAuthRoute
    : !onPlaceholderRoute && firstRootSegment !== "auth");
  const readyToReveal = navigationReady && (!privacyShielded || !!privacyRefreshError);

  const verifySharedHousehold = useCallback((blocking: boolean) => {
    const generation = ++privacyRefreshGenerationRef.current;
    if (blocking) setPrivacyShielded(true);
    setPrivacyRefreshError(null);
    void withStartupTimeout(
      privacyRefreshRef.current(),
      PRIVACY_REFRESH_TIMEOUT_MS,
      "Household access check",
    ).then(() => {
      if (generation !== privacyRefreshGenerationRef.current || AppState.currentState !== "active") return;
      lastPrivacyVerificationAtRef.current = Date.now();
      setPrivacyShielded(false);
    }).catch(() => {
      if (generation !== privacyRefreshGenerationRef.current || AppState.currentState !== "active") return;
      if (blocking) {
        setPrivacyShielded(true);
        setPrivacyRefreshError("Your plan could not be verified. Check your connection, then try again.");
      }
    });
  }, []);

  // Cold start still waits for the first authoritative plan load. Once a plan
  // has been shown, later background refreshes must never cover the cached UI.
  useEffect(() => {
    if (Platform.OS === "web" || authLoading) return;
    if (!session) {
      hasRevealedPlanRef.current = false;
      verifiedPrivacyScopeRef.current = null;
      lastPrivacyVerificationAtRef.current = 0;
      setPrivacyShielded(false);
      setPrivacyRefreshError(null);
      return;
    }
    if (budgetLoading) {
      if (!hasRevealedPlanRef.current) setPrivacyShielded(true);
      return;
    }

    const scopeKey = `${session.user.id}:${activeHousehold?.householdId ?? "personal"}`;
    if (verifiedPrivacyScopeRef.current !== scopeKey) {
      verifiedPrivacyScopeRef.current = scopeKey;
      lastPrivacyVerificationAtRef.current = Date.now();
    }
    hasRevealedPlanRef.current = true;
    if (AppState.currentState === "active") {
      setPrivacyShielded(false);
      setPrivacyRefreshError(null);
    }
  }, [activeHousehold?.householdId, authLoading, budgetLoading, session?.user.id]);

  // Act only on real background/foreground transitions. A quick return shows
  // the cached plan immediately; a stale shared-household session is verified
  // before sensitive data is revealed.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", state => {
      const previous = previousAppStateRef.current;
      previousAppStateRef.current = state;
      if (state !== "active") {
        privacyRefreshGenerationRef.current += 1;
        setPrivacyShielded(true);
        setPrivacyRefreshError(null);
        return;
      }
      if (previous === "active") return;

      const scope = privacyScopeRef.current;
      if (!scope.userId || !hasRevealedPlanRef.current) return;
      if (scope.isPersonal) {
        setPrivacyShielded(false);
        setPrivacyRefreshError(null);
        return;
      }

      const verificationIsFresh = Date.now() - lastPrivacyVerificationAtRef.current < SHARED_HOUSEHOLD_PRIVACY_TTL_MS;
      if (verificationIsFresh) setPrivacyShielded(false);
      verifySharedHousehold(!verificationIsFresh);
    });
    return () => {
      privacyRefreshGenerationRef.current += 1;
      subscription.remove();
    };
  }, [session?.user.id, verifySharedHousehold]);

  useEffect(() => {
    if (privacyRefreshRetry === 0 || AppState.currentState !== "active") return;
    const scope = privacyScopeRef.current;
    if (!scope.userId || scope.isPersonal) return;
    verifySharedHousehold(true);
  }, [privacyRefreshRetry, verifySharedHousehold]);

  useEffect(() => {
    if (initialAppReady) setAppReady(true);
  }, [initialAppReady]);

  useEffect(() => {
    if (appReady) void hideSplash();
  }, [appReady, hideSplash]);

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
      <View
        accessibilityElementsHidden={biometricLocked || privacyShielded || !readyToReveal}
        importantForAccessibility={biometricLocked || privacyShielded || !readyToReveal ? "no-hide-descendants" : "auto"}
        style={styles.transitionContent}
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
      </View>
      {!readyToReveal ? (
        <View style={styles.startupOverlay}>
          <AppLoadingIntro phase="app" />
        </View>
      ) : null}
      {coreReady ? <BiometricLockGate /> : null}
      {privacyShielded && readyToReveal ? (
        <View
          accessibilityViewIsModal
          style={[styles.privacyShield, { backgroundColor: colors.background }]}
        >
          {privacyRefreshError ? (
            <View style={styles.privacyShieldError}>
              <Text accessibilityLiveRegion="polite" style={[styles.privacyShieldMessage, { color: colors.mutedForeground }]}>
                {privacyRefreshError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading your plan again"
                onPress={() => setPrivacyRefreshRetry(value => value + 1)}
                style={({ pressed }) => [
                  styles.privacyShieldRetry,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <Text style={[styles.privacyShieldRetryText, { color: colors.primaryForeground }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
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
          <NetworkStatusProvider>
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
          </NetworkStatusProvider>
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
  privacyShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyShieldError: {
    width: "100%",
    maxWidth: 340,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  privacyShieldMessage: {
    marginTop: 18,
    textAlign: "center",
    fontSize: 15,
    lineHeight: 21,
    fontFamily: "Inter_600SemiBold",
  },
  privacyShieldRetry: {
    minWidth: 132,
    minHeight: 48,
    marginTop: 18,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyShieldRetryText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
});

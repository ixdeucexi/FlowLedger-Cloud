import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import {
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FloLauncher } from "@/components/FloLauncher";
import { BiometricLockGate } from "@/components/BiometricLockGate";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PlaidOAuthResume } from "@/components/PlaidOAuthResume";
import { AppLoadingIntro } from "@/components/AppLoadingIntro";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import {
  BiometricLockProvider,
  useBiometricLock,
} from "@/context/BiometricLockContext";
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
import {
  notificationHouseholdAction,
  type NativeNotificationDestination,
} from "@/lib/nativeNotificationRoute";
import { verifyCurrentHouseholdMembership } from "@/lib/households";
import { ownsLegacyPersonalRows } from "@/lib/householdDataScope";
import { apiConfigurationError } from "@/lib/api";
import { supabaseConfigurationError } from "@/lib/supabase";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

const queryClient = new QueryClient();
const PRIVACY_REFRESH_TIMEOUT_MS = 10_000;

function isPrivacySurfaceActive() {
  if (Platform.OS === "web") {
    return (
      typeof document === "undefined" || document.visibilityState === "visible"
    );
  }
  return AppState.currentState === "active";
}

function withStartupTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out.`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function AuthObserver() {
  const { session, loading } = useAuth();
  const {
    activeHousehold,
    households,
    loading: budgetLoading,
    settings,
    switchHousehold,
  } = useBudget();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const searchParams =
    useGlobalSearchParams<Record<string, string | string[]>>();
  const restoreAttemptRef = useRef<string | null>(null);
  const notificationInitialRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    configureNativeNotificationPresentation();
    if (loading || budgetLoading || !session) return;
    const openRoute = async (destination: NativeNotificationDestination) => {
      try {
        if (
          destination.householdId &&
          !(await verifyCurrentHouseholdMembership(
            session.user.id,
            destination.householdId,
          ))
        ) {
          throw new Error("HOUSEHOLD_UNAVAILABLE");
        }
        const action = notificationHouseholdAction(
          activeHousehold?.householdId ?? null,
          households.map((household) => household.householdId),
          destination.householdId,
        );
        if (action === "reject") throw new Error("HOUSEHOLD_UNAVAILABLE");
        if (action === "switch" && destination.householdId)
          await switchHousehold(destination.householdId);
        router.push(destination.route as any);
      } catch {
        Alert.alert(
          "Notification unavailable",
          "You no longer have access to the household for this notification.",
        );
      }
    };
    if (notificationInitialRef.current !== session.user.id) {
      notificationInitialRef.current = session.user.id;
      void getInitialNotificationRoute().then((destination) => {
        if (destination) void openRoute(destination);
      });
    }
    const unsubscribe = subscribeToNotificationRoutes((destination) => {
      void openRoute(destination);
    });
    return unsubscribe;
  }, [
    activeHousehold?.householdId,
    budgetLoading,
    households,
    loading,
    router,
    session?.user.id,
    switchHousehold,
  ]);

  useEffect(() => {
    if (
      Platform.OS === "web" ||
      loading ||
      budgetLoading ||
      !session?.access_token ||
      !activeHousehold?.householdId
    )
      return;
    const reportFailure = (error: unknown) => {
      console.warn("Native notification registration needs attention.", error);
    };
    void restorePushNotifications(
      session.access_token,
      session.user.id,
      activeHousehold.householdId,
    ).catch(reportFailure);
    return subscribeToPushTokenRotation(
      session.access_token,
      session.user.id,
      activeHousehold.householdId,
      reportFailure,
    );
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
    const isPasswordReset =
      isAuthCallback && String(segments[1] ?? "") === "reset-password";
    const isPublicSupport = firstSegment === "support";
    const isPublicDeletionRequest = firstSegment === "delete-account";
    const atRoot = !firstSegment || firstSegment === "index";

    const replaceRoute = (destination: string) => {
      router.replace(destination as any);
    };

    const householdId =
      activeHousehold?.householdId ??
      `personal-${session?.user.id ?? "signed-out"}`;

    if (
      !session &&
      !inAuth &&
      !isPublicSupport &&
      !isPublicDeletionRequest &&
      !isAuthCallback
    ) {
      replaceRoute("/login");
    } else if (
      session &&
      (inAuth || (isAuthCallback && !isPasswordReset) || atRoot)
    ) {
      let requestedSetup = false;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          requestedSetup =
            window.localStorage.getItem("flowledger_show_setup_after_login") ===
            "true";
          if (requestedSetup)
            window.localStorage.removeItem("flowledger_show_setup_after_login");
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
        )
          .catch(() => null)
          .then((destination) => {
            if (!cancelled) replaceRoute(destination ?? "/(tabs)");
          });
        return () => {
          cancelled = true;
        };
      }
      replaceRoute(settings.onboarding_completed ? "/(tabs)" : "/setup");
      return;
    }

    if (
      session &&
      !inAuth &&
      !isAuthCallback &&
      !atRoot &&
      !isPublicSupport &&
      !isPublicDeletionRequest
    ) {
      restoreAttemptRef.current = null;
      void rememberAppRoute(session.user.id, householdId, currentRoute);
    }
  }, [
    activeHousehold?.householdId,
    budgetLoading,
    currentRoute,
    loading,
    router,
    segments,
    session,
    settings.onboarding_completed,
  ]);

  useEffect(() => {
    if (
      loading ||
      budgetLoading ||
      !session ||
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }

    const householdId =
      activeHousehold?.householdId ?? `personal-${session.user.id}`;
    const rememberRouteBeforePause = () =>
      void rememberAppRoute(session.user.id, householdId, currentRoute);
    const rememberRouteWhenHidden = () => {
      if (document.visibilityState === "hidden") rememberRouteBeforePause();
    };

    window.addEventListener("pagehide", rememberRouteBeforePause);
    document.addEventListener("visibilitychange", rememberRouteWhenHidden);

    return () => {
      window.removeEventListener("pagehide", rememberRouteBeforePause);
      document.removeEventListener("visibilitychange", rememberRouteWhenHidden);
    };
  }, [
    activeHousehold?.householdId,
    budgetLoading,
    currentRoute,
    loading,
    session,
  ]);

  return null;
}

function RootNavigator({
  fontsReady,
  hideSplash,
}: {
  fontsReady: boolean;
  hideSplash: () => Promise<void>;
}) {
  const colors = useColors();
  const { session, loading: authLoading } = useAuth();
  const {
    activeHousehold,
    loading: budgetLoading,
    loadError: budgetLoadError,
    retryBudgetLoad,
    refreshHouseholdsForPrivacy,
  } = useBudget();
  const { ready: biometricLockReady, locked: biometricLocked } =
    useBiometricLock();
  const { ready: themeReady } = useThemeMode();
  const router = useRouter();
  const pathname = usePathname();
  const rootSegments = useSegments();
  const isDesktop = useDesktopExperience();
  const [appReady, setAppReady] = useState(false);
  const [privacyShielded, setPrivacyShielded] = useState(
    !isPrivacySurfaceActive(),
  );
  const [privacyRefreshError, setPrivacyRefreshError] = useState<string | null>(
    null,
  );
  const [privacyRefreshRetry, setPrivacyRefreshRetry] = useState(0);
  const [verifiedPrivacyScopeKey, setVerifiedPrivacyScopeKey] = useState<string | null>(null);
  const privacyRefreshGenerationRef = useRef(0);
  const privacySessionUserIdRef = useRef(session?.user.id ?? null);
  const previousAppStateRef = useRef(AppState.currentState);
  const webWasHiddenRef = useRef(
    Platform.OS === "web"
    && typeof document !== "undefined"
    && document.visibilityState === "hidden",
  );
  const hasRevealedPlanRef = useRef(false);
  const privacyScopeRef = useRef({
    userId: session?.user.id ?? null,
    householdId: activeHousehold?.householdId ?? null,
    isPersonal: activeHousehold?.isPersonal ?? true,
    role: activeHousehold?.role ?? null,
  });
  const privacyRefreshRef = useRef(refreshHouseholdsForPrivacy);
  privacyScopeRef.current = {
    userId: session?.user.id ?? null,
    householdId: activeHousehold?.householdId ?? null,
    isPersonal: activeHousehold?.isPersonal ?? true,
    role: activeHousehold?.role ?? null,
  };
  privacyRefreshRef.current = refreshHouseholdsForPrivacy;
  useLayoutEffect(() => {
    const nextUserId = session?.user.id ?? null;
    if (privacySessionUserIdRef.current === nextUserId) return;
    privacySessionUserIdRef.current = nextUserId;
    privacyRefreshGenerationRef.current += 1;
    hasRevealedPlanRef.current = false;
    setVerifiedPrivacyScopeKey(null);
    setPrivacyRefreshError(null);
    setPrivacyShielded(Boolean(nextUserId));
  }, [session?.user.id]);
  const coreReady =
    fontsReady && !authLoading && biometricLockReady && themeReady;
  // The native splash must never wait on network data. Render the app-owned
  // loading route as soon as fonts/auth/lock/theme are ready, then let routing
  // and plan restoration finish behind one constant FlowLedger screen.
  const initialAppReady = coreReady;
  const firstRootSegment = rootSegments[0] as string | undefined;
  const secondRootSegment = rootSegments[1] as string | undefined;
  const onPlaceholderRoute = !firstRootSegment || firstRootSegment === "index";
  const onPendingAuthRoute =
    firstRootSegment === "login" ||
    (firstRootSegment === "auth" && secondRootSegment !== "reset-password");
  const navigationReady =
    appReady &&
    (session
      ? !onPlaceholderRoute && !onPendingAuthRoute
      : !onPlaceholderRoute && firstRootSegment !== "auth");
  const currentPrivacyScopeKey = session
    ? `${session.user.id}:${activeHousehold?.householdId ?? "personal"}`
    : null;
  // Child routes retain local state across provider changes. A previously
  // revealed scope must stay covered synchronously until the replacement
  // scope's core has committed and passive child cleanup has run.
  const effectivePrivacyShielded = privacyShielded || Boolean(
    currentPrivacyScopeKey
    && verifiedPrivacyScopeKey
    && verifiedPrivacyScopeKey !== currentPrivacyScopeKey,
  );
  const navigatorPrivacyKey = session
    ? verifiedPrivacyScopeKey ?? `pending:${session.user.id}`
    : "signed-out";
  const readyToReveal =
    navigationReady && (!effectivePrivacyShielded || !!privacyRefreshError);

  const verifySharedHousehold = useCallback((blocking: boolean) => {
    const generation = ++privacyRefreshGenerationRef.current;
    if (blocking) setPrivacyShielded(true);
    setPrivacyRefreshError(null);
    void withStartupTimeout(
      privacyRefreshRef.current(),
      PRIVACY_REFRESH_TIMEOUT_MS,
      "Household access check",
    )
      .then(() => {
        if (
          generation !== privacyRefreshGenerationRef.current ||
          !isPrivacySurfaceActive()
        )
          return;
        setPrivacyShielded(false);
      })
      .catch(() => {
        if (
          generation !== privacyRefreshGenerationRef.current ||
          !isPrivacySurfaceActive()
        )
          return;
        if (blocking) {
          setPrivacyShielded(true);
          setPrivacyRefreshError(
            "Your plan could not be verified. Check your connection, then try again.",
          );
        }
      });
  }, []);

  // Plan loading is a workspace concern, not a privacy event. The privacy
  // shield is reserved for a real shared-household access check so optional
  // or slow plan requests can never hold the root shell hostage.
  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      hasRevealedPlanRef.current = false;
      setVerifiedPrivacyScopeKey(null);
      setPrivacyShielded(false);
      setPrivacyRefreshError(null);
      return;
    }
    if (budgetLoading || budgetLoadError) {
      return;
    }

    const scopeKey = `${session.user.id}:${activeHousehold?.householdId ?? "personal"}`;
    setVerifiedPrivacyScopeKey(scopeKey);
    hasRevealedPlanRef.current = true;
    if (isPrivacySurfaceActive()) {
      setPrivacyShielded(false);
      setPrivacyRefreshError(null);
    }
  }, [
    activeHousehold?.householdId,
    authLoading,
    budgetLoadError,
    budgetLoading,
    session?.user.id,
  ]);

  // Act only on real native background/foreground transitions. Personal plans
  // reveal their cached screen immediately. Shared plans stay mounted behind
  // the privacy shield until current membership is verified.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
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
      if (ownsLegacyPersonalRows(scope)) {
        setPrivacyShielded(false);
        setPrivacyRefreshError(null);
        return;
      }

      verifySharedHousehold(true);
    });
    return () => {
      privacyRefreshGenerationRef.current += 1;
      subscription.remove();
    };
  }, [session?.user.id, verifySharedHousehold]);

  // Web tabs do not emit reliable native AppState transitions. Shield a shared
  // plan as soon as the page becomes hidden, then verify membership once on the
  // matching visible/pageshow transition. The cached route remains mounted, so
  // this does not remount tabs or start a broad financial reload.
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    )
      return;

    const markHidden = () => {
      webWasHiddenRef.current = true;
      privacyRefreshGenerationRef.current += 1;
      setPrivacyRefreshError(null);
      const scope = privacyScopeRef.current;
      if (scope.userId && hasRevealedPlanRef.current) {
        setPrivacyShielded(true);
      }
    };

    const verifyAfterReturn = () => {
      if (document.visibilityState !== "visible" || !webWasHiddenRef.current)
        return;
      webWasHiddenRef.current = false;
      const scope = privacyScopeRef.current;
      if (!scope.userId || !hasRevealedPlanRef.current) return;
      if (ownsLegacyPersonalRows(scope)) {
        setPrivacyShielded(false);
        setPrivacyRefreshError(null);
        return;
      }
      verifySharedHousehold(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") markHidden();
      else verifyAfterReturn();
    };

    // The page can mount already hidden (restored/background PWA tab). Record
    // that transition now so its first visible event verifies and unshields.
    if (document.visibilityState === "hidden") markHidden();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", markHidden);
    window.addEventListener("pageshow", verifyAfterReturn);
    return () => {
      privacyRefreshGenerationRef.current += 1;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", markHidden);
      window.removeEventListener("pageshow", verifyAfterReturn);
    };
  }, [session?.user.id, verifySharedHousehold]);

  useEffect(() => {
    if (privacyRefreshRetry === 0 || !isPrivacySurfaceActive()) return;
    const scope = privacyScopeRef.current;
    if (
      !scope.userId ||
      ownsLegacyPersonalRows(scope)
    )
      return;
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

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (router.canGoBack()) {
          router.back();
          return true;
        }

        return false;
      },
    );

    return () => subscription.remove();
  }, [appReady, router]);

  return (
    <View
      style={[styles.transitionRoot, { backgroundColor: colors.background }]}
    >
      <View
        accessibilityElementsHidden={
          biometricLocked || effectivePrivacyShielded || !readyToReveal
        }
        importantForAccessibility={
          biometricLocked || effectivePrivacyShielded || !readyToReveal
            ? "no-hide-descendants"
            : "auto"
        }
        style={styles.transitionContent}
      >
        {appReady ? (
          <>
            <AuthObserver />
            <GestureHandlerRootView key={navigatorPrivacyKey} style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="auth/callback" />
                <Stack.Screen name="auth/reset-password" />
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
              {!biometricLocked &&
              [
                "/snowball-plan",
                "/planned-debt-payment",
                "/plan-simulator",
              ].includes(pathname) ? (
                <FloLauncher desktop={isDesktop} />
              ) : null}
            </GestureHandlerRootView>
          </>
        ) : null}
      </View>
      {!readyToReveal ? (
        <View style={styles.startupOverlay}>
          {effectivePrivacyShielded && budgetLoadError ? (
            <View style={styles.privacyShieldError}>
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.privacyShieldMessage,
                  { color: colors.mutedForeground },
                ]}
              >
                Your newly selected plan could not be loaded. Your previous plan remains hidden.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading the selected plan again"
                onPress={retryBudgetLoad}
                style={({ pressed }) => [
                  styles.privacyShieldRetry,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.privacyShieldRetryText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : (
            <AppLoadingIntro phase="app" />
          )}
        </View>
      ) : null}
      {coreReady ? <BiometricLockGate /> : null}
      {effectivePrivacyShielded && readyToReveal ? (
        <View
          accessibilityViewIsModal
          style={[styles.privacyShield, { backgroundColor: colors.background }]}
        >
          {privacyRefreshError ? (
            <View style={styles.privacyShieldError}>
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.privacyShieldMessage,
                  { color: colors.mutedForeground },
                ]}
              >
                {privacyRefreshError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading your plan again"
                onPress={() => setPrivacyRefreshRetry((value) => value + 1)}
                style={({ pressed }) => [
                  styles.privacyShieldRetry,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.privacyShieldRetryText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Try again
                </Text>
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

  const runtimeConfigurationError =
    supabaseConfigurationError ?? apiConfigurationError();

  useEffect(() => {
    if (runtimeConfigurationError && fontsReady) void hideSplash();
  }, [fontsReady, hideSplash, runtimeConfigurationError]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    let viewport = document.querySelector(
      'meta[name="viewport"]',
    ) as HTMLMetaElement | null;
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.name = "viewport";
      document.head.appendChild(viewport);
    }

    viewport.setAttribute("content", WEB_VIEWPORT_CONTENT);
  }, []);

  if (runtimeConfigurationError) {
    return (
      <SafeAreaProvider>
        <View style={styles.configurationErrorScreen}>
          <Feather name="alert-triangle" size={30} color="#FB7185" />
          <Text style={styles.configurationErrorTitle}>App configuration needed</Text>
          <Text style={styles.configurationErrorMessage}>
            {runtimeConfigurationError} Install a correctly configured FlowLedger build and try again.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

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
                      <RootNavigator
                        fontsReady={fontsReady}
                        hideSplash={hideSplash}
                      />
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
  configurationErrorScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 28,
    backgroundColor: "#050816",
  },
  configurationErrorTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    fontFamily: "Inter_800ExtraBold",
    textAlign: "center",
  },
  configurationErrorMessage: {
    maxWidth: 440,
    color: "#AAB4C8",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
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

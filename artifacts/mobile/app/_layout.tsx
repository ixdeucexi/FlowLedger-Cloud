import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Image, Platform, StyleSheet, StyleProp, Text, View, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { readLastAppRoute, rememberCurrentAppRoute } from "@/lib/navigationMemory";
import { supabase } from "@/lib/supabase";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const MIN_STARTUP_MS = 450;

function AuthObserver() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const firstSegment = segments[0] as string | undefined;
    const secondSegment = segments[1] as string | undefined;
    const inAuth = firstSegment === "login";
    const atRoot = !firstSegment || firstSegment === "index";
    const inPlaidOAuthCallback = firstSegment === "plaid" && secondSegment === "oauth";

    if (inPlaidOAuthCallback) {
      return;
    }

    if (!session && !inAuth) {
      router.replace("/login");
    } else if (session && (inAuth || atRoot)) {
      let requestedSetup = false;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          requestedSetup = window.localStorage.getItem("flowledger_show_setup_after_login") === "true";
          if (requestedSetup) window.localStorage.removeItem("flowledger_show_setup_after_login");
        } catch {}
      }
      if (!requestedSetup) {
        router.replace((readLastAppRoute() ?? "/(tabs)") as any);
        return;
      }
      let cancelled = false;
      void supabase
        .from("settings")
        .select("onboarding_completed")
        .eq("user_id", session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          router.replace(data?.onboarding_completed ? "/(tabs)" : "/setup");
        }, () => {
          if (!cancelled) router.replace("/(tabs)");
        });
      return () => {
        cancelled = true;
      };
    }

    if (session && !inAuth && !atRoot && !inPlaidOAuthCallback) {
      rememberCurrentAppRoute();
    }
  }, [session, loading, segments, router]);

  useEffect(() => {
    if (loading || !session || Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const rememberRouteBeforePause = () => rememberCurrentAppRoute();
    const rememberRouteWhenHidden = () => {
      if (document.visibilityState === "hidden") rememberCurrentAppRoute();
    };

    window.addEventListener("pagehide", rememberRouteBeforePause);
    document.addEventListener("visibilitychange", rememberRouteWhenHidden);

    return () => {
      window.removeEventListener("pagehide", rememberRouteBeforePause);
      document.removeEventListener("visibilitychange", rememberRouteWhenHidden);
    };
  }, [session, loading]);

  return null;
}

function StartupScreen({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const colors = useColors();
  return (
    <Animated.View style={[styles.startup, { backgroundColor: colors.background }, style]}>
      <Image
        source={require("../assets/images/startup_f_transparent.png")}
        style={styles.startupIcon}
        resizeMode="contain"
      />
      <Text style={[styles.startupTitle, { color: colors.foreground }]}>FlowLedger Algo</Text>
    </Animated.View>
  );
}

function RootNavigator({ fontsReady, hideSplash }: { fontsReady: boolean; hideSplash: () => void }) {
  const colors = useColors();
  const { loading: authLoading } = useAuth();
  const { ready: themeReady } = useThemeMode();
  const router = useRouter();
  const [minimumStartupReady, setMinimumStartupReady] = useState(false);
  const [showStartupOverlay, setShowStartupOverlay] = useState(true);
  const startupOpacity = useRef(new Animated.Value(1)).current;
  const appOpacity = useRef(new Animated.Value(0)).current;
  const servicesReady = fontsReady && !authLoading && themeReady;
  const appReady = servicesReady && minimumStartupReady;

  useEffect(() => {
    const t = setTimeout(() => setMinimumStartupReady(true), MIN_STARTUP_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!appReady) {
      startupOpacity.setValue(1);
      appOpacity.setValue(0);
      setShowStartupOverlay(true);
      return;
    }

    hideSplash();
    setShowStartupOverlay(true);
    Animated.parallel([
      Animated.timing(startupOpacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(appOpacity, {
        toValue: 1,
        duration: 520,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setShowStartupOverlay(false));
  }, [appReady, appOpacity, hideSplash, startupOpacity]);

  useEffect(() => {
    const t = setTimeout(hideSplash, 3000);
    return () => clearTimeout(t);
  }, [hideSplash]);

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

  if (!appReady) return <StartupScreen />;

  return (
    <View style={[styles.transitionRoot, { backgroundColor: colors.background }]}>
      <Animated.View style={[styles.transitionContent, { opacity: appOpacity }]}>
        <AuthObserver />
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="setup" />
            <Stack.Screen name="plaid/oauth" />
            <Stack.Screen name="(tabs)" />
          </Stack>
          <PwaInstallPrompt />
        </GestureHandlerRootView>
      </Animated.View>
      {showStartupOverlay ? (
        <StartupScreen style={[styles.startupOverlay, { opacity: startupOpacity }]} />
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
  });
  const fontsReady = fontsLoaded || !!fontError;

  const hiddenRef = useRef(false);
  const hideSplash = useCallback(() => {
    if (hiddenRef.current) return;
    hiddenRef.current = true;
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RootNavigator fontsReady={fontsReady} hideSplash={hideSplash} />
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
  startupTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
  },
});

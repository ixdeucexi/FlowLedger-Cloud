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
import React, { useCallback, useEffect, useRef } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useThemeMode } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function AuthObserver() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const firstSegment = segments[0] as string | undefined;
    const inAuth = firstSegment === "login";
    const atRoot = !firstSegment || firstSegment === "index";
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
        router.replace("/(tabs)");
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
  }, [session, loading, segments, router]);

  return null;
}

function StartupScreen() {
  return (
    <View style={styles.startup}>
      <Image
        source={require("../assets/images/logo_transparent.png")}
        style={styles.startupLogo}
        resizeMode="contain"
      />
      <Text style={styles.logoSub}>Your money, clearly.</Text>
    </View>
  );
}

function RootNavigator({ fontsReady, hideSplash }: { fontsReady: boolean; hideSplash: () => void }) {
  const { loading: authLoading } = useAuth();
  const { ready: themeReady } = useThemeMode();
  const appReady = fontsReady && !authLoading && themeReady;

  useEffect(() => {
    if (appReady) hideSplash();
  }, [appReady, hideSplash]);

  useEffect(() => {
    const t = setTimeout(hideSplash, 3000);
    return () => clearTimeout(t);
  }, [hideSplash]);

  if (!appReady) return <StartupScreen />;

  return (
    <>
      <AuthObserver />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="setup" />
          <Stack.Screen name="(tabs)" />
        </Stack>
        <PwaInstallPrompt />
      </GestureHandlerRootView>
    </>
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
  startup: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0e1a",
  },
  startupLogo: {
    width: 280,
    height: 116,
    marginBottom: 6,
  },
  logoSub: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 4,
  },
});

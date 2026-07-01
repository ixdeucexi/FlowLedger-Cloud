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
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useThemeMode } from "@/context/ThemeContext";

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
      let showSetup = false;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        try {
          showSetup = window.localStorage.getItem("flowledger_show_setup_after_login") === "true";
          if (showSetup) window.localStorage.removeItem("flowledger_show_setup_after_login");
        } catch {}
      }
      router.replace(showSetup ? "/(tabs)/more" : "/(tabs)");
    }
  }, [session, loading, segments, router]);

  return null;
}

function StartupScreen() {
  return (
    <View style={styles.startup}>
      <View style={styles.logoMark}>
        <Text style={styles.logoGlyph}>F</Text>
      </View>
      <Text style={styles.logoText}>FlowLedger</Text>
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
          <Stack.Screen name="(tabs)" />
        </Stack>
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
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.3)",
    marginBottom: 14,
  },
  logoGlyph: {
    color: "#22c55e",
    fontSize: 30,
    fontWeight: "800",
  },
  logoText: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
  },
  logoSub: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 4,
  },
});

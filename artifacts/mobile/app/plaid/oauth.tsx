"use client";

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloLogo } from "@/components/FloLogo";
import { PlaidLinkLauncher } from "@/components/PlaidLinkLauncher.web";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { clearPlaidOAuthLinkSession, readPlaidOAuthLinkSession } from "@/lib/plaidOAuthSession";
import { supabase } from "@/lib/supabase";

const ACTIVE_SETTINGS_SECTION_KEY = "flowledger_active_settings_section";
const PLAID_RETURN_NOTICE_KEY = "flowledger_plaid_return_notice";

export default function PlaidOAuthCallbackPage() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [shouldOpen, setShouldOpen] = useState(false);
  const [status, setStatus] = useState("Preparing secure bank connection...");
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const hasOAuthState = useMemo(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("oauth_state_id");
  }, []);

  const returnToBankSync = useCallback((notice?: string) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(ACTIVE_SETTINGS_SECTION_KEY, "plaid");
        if (notice) window.sessionStorage.setItem(PLAID_RETURN_NOTICE_KEY, notice);
      } catch {}
    }
    router.replace("/more" as any);
  }, [router]);

  useEffect(() => {
    if (loading || !session) return;
    if (!hasOAuthState) {
      setError("Plaid did not return an OAuth session. Please start bank sync again.");
      return;
    }
    const stored = readPlaidOAuthLinkSession();
    if (!stored?.linkToken) {
      setError("This Plaid session expired. Please tap Connect Bank Account again.");
      return;
    }
    setLinkToken(stored.linkToken);
    setStatus("Finishing secure bank sign-in...");
    setShouldOpen(true);
  }, [hasOAuthState, loading, session]);

  const authHeaders = useCallback(async () => {
    let accessToken = session?.access_token ?? null;
    if (!accessToken) {
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    }
    if (!accessToken || accessToken === "dev-demo") {
      const { data } = await supabase.auth.refreshSession();
      accessToken = data.session?.access_token ?? accessToken;
    }
    if (!accessToken || accessToken === "dev-demo") {
      throw new Error("Please sign in again before finishing bank sync.");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
  }, [session?.access_token]);

  const handleSuccess = useCallback(async (publicToken: string, metadata: any) => {
    setShouldOpen(false);
    setStatus("Saving your secure bank connection...");
    try {
      const response = await fetch("/api/plaid/exchange-public-token", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          public_token: publicToken,
          household_id: null,
          institution_name: metadata?.institution?.name ?? null,
          institution_id: metadata?.institution?.institution_id ?? null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Bank connection could not be saved.");
      }
      clearPlaidOAuthLinkSession();
      setCompleted(true);
      setStatus(payload.message || "Bank connected. FlowLedger is syncing account activity.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => returnToBankSync(payload.message || "Bank connected. FlowLedger is syncing account activity."), 900);
    } catch (caught) {
      clearPlaidOAuthLinkSession();
      const message = caught instanceof Error ? caught.message : "Bank connection could not be saved.";
      setError(message);
      setStatus("Bank sync needs attention.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [authHeaders, returnToBankSync]);

  const handleExit = useCallback((plaidError: any, metadata?: any) => {
    clearPlaidOAuthLinkSession();
    setShouldOpen(false);
    const safeCode = plaidError?.error_code || plaidError?.error_type || metadata?.status;
    setError(safeCode ? `Plaid closed before finishing (${safeCode}).` : "Plaid was closed before finishing.");
    setStatus("Bank sync was not completed.");
  }, []);

  const body = loading
    ? "Checking your secure session..."
    : !session
      ? "Please sign in again, then reconnect your bank."
      : error
        ? error
        : completed
          ? status
          : "Plaid will reopen for one more secure step.";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
      <PremiumBackdrop variant="blue" />
      <PlaidLinkLauncher
        linkToken={linkToken}
        shouldOpen={shouldOpen}
        onOpened={() => {
          setShouldOpen(false);
          setStatus("Plaid is reopening...");
        }}
        onSuccess={handleSuccess}
        onExit={handleExit}
      />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <FloLogo size={86} />
        <Text style={[styles.title, { color: colors.foreground }]}>Finishing bank sync</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{body}</Text>
        {!error && !completed ? (
          <ActivityIndicator color={colors.primary} size="large" style={styles.spinner} />
        ) : null}
        {error ? (
          <Pressable
            onPress={() => returnToBankSync()}
            style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 }]}
          >
            <Feather name="arrow-left" size={18} color="#fff" />
            <Text style={styles.buttonText}>Back to Bank Sync</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 28,
    padding: 28,
  },
  title: {
    marginTop: 18,
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  spinner: {
    marginTop: 22,
  },
  button: {
    marginTop: 24,
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});

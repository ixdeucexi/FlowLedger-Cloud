"use client";

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { usePlaidLink } from "react-plaid-link";

import { useAuth } from "@/context/AuthContext";
import {
  clearPlaidOAuthSession,
  readPendingPlaidOAuthSession,
  readPlaidOAuthSession,
  savePlaidConnectionResult,
} from "@/lib/plaidOAuth";

export function PlaidOAuthResume() {
  const { session } = useAuth();
  const router = useRouter();
  const readResume = useCallback(() => {
    if (!session?.user.id || typeof window === "undefined") return null;
    const redirected = readPlaidOAuthSession(window.localStorage, window.location.href, session.user.id);
    if (redirected) return redirected;
    const pending = readPendingPlaidOAuthSession(window.localStorage, session.user.id);
    return pending ? { ...pending, receivedRedirectUri: undefined } : null;
  }, [session?.user.id]);
  const [resume, setResume] = useState(readResume);

  useEffect(() => {
    const detectReturn = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      setResume(current => current ?? readResume());
    };
    detectReturn();
    window.addEventListener("focus", detectReturn);
    document.addEventListener("visibilitychange", detectReturn);
    return () => {
      window.removeEventListener("focus", detectReturn);
      document.removeEventListener("visibilitychange", detectReturn);
    };
  }, [readResume]);

  const finish = useCallback((message: string) => {
    if (typeof window !== "undefined") {
      clearPlaidOAuthSession(window.localStorage);
      savePlaidConnectionResult(window.localStorage, message);
    }
    setResume(null);
    router.replace("/(tabs)/more?section=plaid" as never);
  }, [router]);

  const onSuccess = useCallback(async (publicToken: string) => {
    if (!resume || !session?.access_token || resume.userId !== session.user.id) {
      finish("Please sign in again, then reconnect the card.");
      return;
    }
    try {
      const response = await fetch("/api/plaid/exchange-public-token", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          "X-FlowLedger-Household-Id": resume.householdId,
        },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Could not finish connecting this card.");
      finish(result.credit_card_debts_count > 0
        ? `${result.credit_card_debts_count} credit card${result.credit_card_debts_count === 1 ? " is" : "s are"} now in Debt and Snowball.`
        : "Card connected. Attach it to Debt and Snowball below.");
    } catch (error) {
      finish(error instanceof Error ? error.message : "Could not finish connecting this card.");
    }
  }, [finish, resume, session?.access_token, session?.user.id]);

  const onExit = useCallback(() => {
    finish("Card connection was not completed. You can try again below.");
  }, [finish]);

  const { ready, error, open } = usePlaidLink({
    token: resume?.linkToken ?? null,
    receivedRedirectUri: resume?.receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (!resume || !ready) return;
    open();
  }, [open, ready, resume]);

  useEffect(() => {
    if (!resume || !error) return;
    finish("Plaid could not resume the card connection. Please try again.");
  }, [error, finish, resume]);

  if (!resume) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator color="#9f7aea" />
        <Text style={styles.title}>Finishing your secure card connection…</Text>
        <Text style={styles.copy}>Keep this page open while FlowLedger attaches the card to your plan.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,8,22,0.84)", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: 20, borderWidth: 1, borderColor: "rgba(159,122,234,0.32)", backgroundColor: "#0a1022", padding: 24, alignItems: "center" },
  title: { color: "#f8fafc", fontSize: 17, fontWeight: "800", marginTop: 14, textAlign: "center" },
  copy: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" },
});

"use client";

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { usePlaidLink } from "react-plaid-link";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import {
  clearPlaidOAuthSession,
  type PlaidOAuthSession,
  readPendingPlaidOAuthSession,
  readPlaidOAuthSession,
  savePlaidConnectionResult,
} from "@/lib/plaidOAuth";

type LegacyResumeProps = {
  resume: PlaidOAuthSession & { receivedRedirectUri?: string };
  onSuccess: (publicToken: string) => Promise<void>;
  onExit: () => void;
  onError: () => void;
};

type ConnectionResult = {
  credit_cards_count?: number;
  credit_card_debts_count?: number;
};

function completedConnectionMessage(result: ConnectionResult) {
  const attachedCards = Number(result.credit_card_debts_count || 0);
  if (attachedCards > 0) {
    return `${attachedCards} credit card${attachedCards === 1 ? " is" : "s are"} now in Debt and Snowball.`;
  }
  if (Number(result.credit_cards_count || 0) > 0) {
    return "Credit card connected. Attach it to Debt and Snowball below.";
  }
  return "Account connected. Recent activity is syncing now.";
}

function LegacyPlaidOAuthResume({ resume, onSuccess, onExit, onError }: LegacyResumeProps) {
  const { ready, error, open } = usePlaidLink({
    token: resume.linkToken,
    receivedRedirectUri: resume.receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready) open();
  }, [open, ready]);

  useEffect(() => {
    if (error) onError();
  }, [error, onError]);

  return null;
}

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
  const hostedCompletionSession = useRef<string | null>(null);

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
      finish("Please sign in again, then reconnect the account.");
      return;
    }
    try {
      const response = await apiFetch("/api/plaid/exchange-public-token", {
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
      if (!response.ok) throw new Error(result.message || "Could not finish connecting this account.");
      finish(completedConnectionMessage(result));
    } catch (error) {
      finish(error instanceof Error ? error.message : "Could not finish connecting this account.");
    }
  }, [finish, resume, session?.access_token, session?.user.id]);

  const onExit = useCallback(() => {
    finish("Account connection was not completed. You can try again below.");
  }, [finish]);
  const onLegacyError = useCallback(() => {
    finish("Plaid could not resume the account connection. Please try again.");
  }, [finish]);

  useEffect(() => {
    if (!resume?.hostedSession
      || !session?.access_token
      || resume.userId !== session.user.id
      || hostedCompletionSession.current === resume.hostedSession) return;
    hostedCompletionSession.current = resume.hostedSession;
    const controller = new AbortController();

    const complete = async () => {
      try {
        for (let attempt = 0; attempt < 20 && !controller.signal.aborted; attempt += 1) {
          const response = await apiFetch("/api/plaid/exchange-public-token", {
            method: "POST",
            credentials: "include",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              "X-FlowLedger-Household-Id": resume.householdId,
            },
            body: JSON.stringify({ hosted_session: resume.hostedSession }),
          });
          const result = await response.json().catch(() => ({}));
          if (response.status === 202) {
            await new Promise(resolve => window.setTimeout(resolve, 1_500));
            continue;
          }
          if (!response.ok) throw new Error(result.message || "Could not finish connecting this account.");
          finish(completedConnectionMessage(result));
          return;
        }
        if (!controller.signal.aborted) finish("Plaid is still finishing this connection. Open Bank connections again in a moment.");
      } catch (completionError) {
        if (!controller.signal.aborted) {
          finish(completionError instanceof Error ? completionError.message : "Could not finish connecting this account.");
        }
      }
    };
    void complete();
    return () => controller.abort();
  }, [finish, resume, session?.access_token, session?.user.id]);

  if (!resume) return null;
  return (
    <>
      {!resume.hostedSession ? (
        <LegacyPlaidOAuthResume resume={resume} onSuccess={onSuccess} onExit={onExit} onError={onLegacyError} />
      ) : null}
      <View accessibilityLiveRegion="polite" style={styles.overlay}>
        <View style={styles.card}>
          <ActivityIndicator color="#9f7aea" />
          <Text style={styles.title}>Finishing your secure account connection…</Text>
          <Text style={styles.copy}>Keep this page open while FlowLedger adds the accounts you selected.</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,8,22,0.84)", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: 20, borderWidth: 1, borderColor: "rgba(159,122,234,0.32)", backgroundColor: "#0a1022", padding: 24, alignItems: "center" },
  title: { color: "#f8fafc", fontSize: 17, fontWeight: "800", marginTop: 14, textAlign: "center" },
  copy: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" },
});

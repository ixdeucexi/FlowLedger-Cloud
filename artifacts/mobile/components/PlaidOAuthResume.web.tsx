import { PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
"use client";

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import { usePlaidLink } from "react-plaid-link";

import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { apiFetch } from "@/lib/api";
import {
  clearPlaidOAuthSession,
  PLAID_CONNECTION_RESULT_EVENT,
  PLAID_OAUTH_SESSION_KEY,
  PLAID_RESUME_CONNECTION_EVENT,
  PlaidCompletionError,
  plaidOAuthSessionKey,
  pollHostedPlaidCompletion,
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
  const opened = useRef(false);
  const { ready, error, open } = usePlaidLink({
    token: resume.linkToken,
    receivedRedirectUri: resume.receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [open, ready]);

  useEffect(() => {
    if (error) onError();
  }, [error, onError]);

  return null;
}

export function PlaidOAuthResume() {
  const { session, demoMode: authDemoMode } = useAuth();
  const { activeHousehold, refreshBankData, demoMode: budgetDemoMode } = useBudget();
  const demoMode = authDemoMode || budgetDemoMode;
  const router = useRouter();
  const userId = session?.user.id ?? "";
  const householdId = activeHousehold?.householdId ?? "";
  const readResume = useCallback(() => {
    if (demoMode || !userId || !householdId || typeof window === "undefined") return null;
    try {
      const redirected = readPlaidOAuthSession(window.localStorage, window.location.href, userId);
      const pending = redirected ?? readPendingPlaidOAuthSession(window.localStorage, userId);
      return pending?.householdId === householdId ? { ...pending, receivedRedirectUri: redirected?.receivedRedirectUri } : null;
    } catch {
      return null;
    }
  }, [demoMode, householdId, userId]);
  const [resume, setResume] = useState(readResume);
  const [retry, setRetry] = useState(0);
  const attemptKey = resume ? plaidOAuthSessionKey(resume) : null;
  const live = useRef({ userId, householdId, attemptKey, demoMode, accessToken: session?.access_token, refreshBankData, mounted: true });
  live.current = { ...live.current, userId, householdId, attemptKey, demoMode, accessToken: session?.access_token, refreshBankData };
  const hostedJob = useRef<{ key: string; promise: ReturnType<typeof pollHostedPlaidCompletion<ConnectionResult>> } | null>(null);
  const legacyJob = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const completedJob = useRef<{ key: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);

  const isCurrent = useCallback((attempt: PlaidOAuthSession) => live.current.mounted
    && !live.current.demoMode
    && live.current.userId === attempt.userId
    && live.current.householdId === attempt.householdId
    && live.current.attemptKey === plaidOAuthSessionKey(attempt), []);

  useEffect(() => {
    const detectReturn = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const next = readResume();
      setResume(current => current && next && plaidOAuthSessionKey(current) === plaidOAuthSessionKey(next) ? current : next);
    };
    const detectStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PLAID_OAUTH_SESSION_KEY) detectReturn();
    };
    detectReturn();
    window.addEventListener("focus", detectReturn);
    window.addEventListener(PLAID_RESUME_CONNECTION_EVENT, detectReturn);
    window.addEventListener("storage", detectStorage);
    document.addEventListener("visibilitychange", detectReturn);
    return () => {
      window.removeEventListener("focus", detectReturn);
      window.removeEventListener(PLAID_RESUME_CONNECTION_EVENT, detectReturn);
      window.removeEventListener("storage", detectStorage);
      document.removeEventListener("visibilitychange", detectReturn);
    };
  }, [readResume]);

  const clearCompletedSession = useCallback((attempt: PlaidOAuthSession) => {
    if (live.current.demoMode) return;
    try { clearPlaidOAuthSession(window.localStorage, attempt); } catch { /* Saved accounts remain authoritative. */ }
  }, []);

  const finish = useCallback((attempt: PlaidOAuthSession, message: string, clear = true) => {
    if (!isCurrent(attempt)) return;
    try {
      if (clear) clearPlaidOAuthSession(window.localStorage, attempt);
      savePlaidConnectionResult(window.localStorage, message, Date.now(), { userId: attempt.userId, householdId: attempt.householdId });
      window.dispatchEvent(new Event(PLAID_CONNECTION_RESULT_EVENT));
    } catch { /* A storage limit must not restart a successful bank sign-in. */ }
    setResume(current => current && plaidOAuthSessionKey(current) === plaidOAuthSessionKey(attempt) ? null : current);
    router.replace("/(tabs)/more?section=plaid" as never);
  }, [isCurrent, router]);

  const completed = useCallback((attempt: PlaidOAuthSession, result: ConnectionResult) => {
    if (!isCurrent(attempt)) {
      clearCompletedSession(attempt);
      return Promise.resolve();
    }
    const key = plaidOAuthSessionKey(attempt);
    if (completedJob.current?.key === key) return completedJob.current.promise;
    const promise = (async () => {
      if (!isCurrent(attempt)) {
        clearCompletedSession(attempt);
        if (completedJob.current?.key === key) completedJob.current = null;
        return;
      }
      let refreshed = true;
      try {
        await live.current.refreshBankData({ savedOnly: true });
      } catch {
        refreshed = false;
      }
      if (!isCurrent(attempt)) {
        clearCompletedSession(attempt);
        if (completedJob.current?.key === key) completedJob.current = null;
        return;
      }
      finish(attempt, refreshed ? completedConnectionMessage(result) : "Account connected. Refresh Bank connections to show your saved accounts.");
    })();
    completedJob.current = { key, promise };
    return promise;
  }, [clearCompletedSession, finish, isCurrent]);

  const onSuccess = useCallback(async (publicToken: string) => {
    const attempt = resume;
    if (!attempt || !isCurrent(attempt) || !live.current.accessToken) return;
    const key = plaidOAuthSessionKey(attempt);
    if (legacyJob.current?.key === key) return legacyJob.current.promise;
    const promise = (async () => {
      try {
        const response = await apiFetch("/api/plaid/exchange-public-token", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${live.current.accessToken}`,
            "X-FlowLedger-Household-Id": attempt.householdId,
          },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new PlaidCompletionError(result.message || "Could not finish connecting this account.", response.status === 400);
        await completed(attempt, result);
      } catch (error) {
        legacyJob.current = null;
        finish(attempt, error instanceof Error ? error.message : "Could not finish connecting this account.", error instanceof PlaidCompletionError && error.clearSession);
      }
    })();
    legacyJob.current = { key, promise };
    return promise;
  }, [completed, finish, isCurrent, resume]);

  const onExit = useCallback(() => {
    if (resume) finish(resume, "Account connection was not completed. You can try again below.");
  }, [finish, resume]);
  const onLegacyError = useCallback(() => {
    if (resume) finish(resume, "Plaid could not resume the account connection. Please try again.");
  }, [finish, resume]);

  useEffect(() => {
    const attempt = resume;
    if (!attempt?.hostedSession || !userId || !householdId || !isCurrent(attempt)) return;
    const key = plaidOAuthSessionKey(attempt);
    let active = true;
    let job = hostedJob.current;
    if (!job || job.key !== key) {
      job = {
        key,
        promise: pollHostedPlaidCompletion<ConnectionResult>({
          isCurrent: () => isCurrent(attempt),
          wait: () => new Promise(resolve => window.setTimeout(resolve, 1_500)),
          request: async () => {
            if (!isCurrent(attempt)) return { status: 202, ok: false, result: {} };
            if (!live.current.accessToken) return { status: 401, ok: false, result: { message: "Please sign in again to finish this connection." } };
            const response = await apiFetch("/api/plaid/exchange-public-token", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${live.current.accessToken}`,
                "X-FlowLedger-Household-Id": attempt.householdId,
              },
              body: JSON.stringify({ hosted_session: attempt.hostedSession }),
            });
            return { status: response.status, ok: response.ok, result: await response.json().catch(() => ({})) };
          },
        }),
      };
      hostedJob.current = job;
    }
    const currentJob = job;
    void currentJob.promise.then(async outcome => {
      if (outcome.status === "success") {
        // A Strict Mode replay subscribes to this same job. Only its live
        // subscriber publishes, while an obsolete scope can clear its own
        // confirmed session without navigating or refreshing another household.
        if (active) await completed(attempt, outcome.result);
        else if (!isCurrent(attempt)) clearCompletedSession(attempt);
        return;
      }
      if (hostedJob.current === currentJob) hostedJob.current = null;
      if (!active || !isCurrent(attempt)) return;
      if (outcome.status === "inactive") {
        setRetry(value => value + 1);
        return;
      }
      finish(attempt, "Plaid is still finishing this connection. Choose Continue connection to check again.", false);
    }).catch(error => {
      if (hostedJob.current === currentJob) hostedJob.current = null;
      if (active) finish(attempt, error instanceof Error ? error.message : "Could not finish connecting this account.", error instanceof PlaidCompletionError && error.clearSession);
    });
    return () => { active = false; };
  }, [attemptKey, clearCompletedSession, completed, demoMode, finish, householdId, isCurrent, resume, retry, userId]);

  if (demoMode || !resume) return null;
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

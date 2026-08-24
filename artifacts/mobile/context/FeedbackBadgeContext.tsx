import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { supabase } from "@/lib/supabase";

interface FeedbackBadgeContextValue {
  newFeedbackCount: number;
  refreshFeedbackCount: () => Promise<void>;
}

const FeedbackBadgeContext = createContext<FeedbackBadgeContextValue | undefined>(undefined);
const FEEDBACK_REFRESH_INTERVAL_MS = 30_000;
const FEEDBACK_REFRESH_STALE_MS = 30_000;

export function FeedbackBadgeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAdmin } = useMembership();
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const feedbackRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const lastFeedbackRefreshAtRef = useRef(0);
  const feedbackRefreshScopeRef = useRef("");
  const feedbackRefreshScope = user?.id && isAdmin ? user.id : "";
  if (feedbackRefreshScopeRef.current !== feedbackRefreshScope) {
    feedbackRefreshScopeRef.current = feedbackRefreshScope;
    feedbackRefreshPromiseRef.current = null;
    lastFeedbackRefreshAtRef.current = 0;
  }

  const refreshFeedbackCount = useCallback(async () => {
    if (!user?.id || !isAdmin) {
      lastFeedbackRefreshAtRef.current = 0;
      setNewFeedbackCount(0);
      return;
    }
    if (feedbackRefreshPromiseRef.current) return feedbackRefreshPromiseRef.current;
    const now = Date.now();
    if (now - lastFeedbackRefreshAtRef.current < FEEDBACK_REFRESH_STALE_MS) return;

    const requestUserId = user.id;
    lastFeedbackRefreshAtRef.current = now;
    const request = (async () => {
      const { count, error } = await supabase
        .from("app_feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .is("archived_at", null);
      if (error) {
        if (feedbackRefreshScopeRef.current === requestUserId) {
          lastFeedbackRefreshAtRef.current = 0;
        }
        return;
      }
      if (feedbackRefreshScopeRef.current === requestUserId) {
        setNewFeedbackCount(Math.max(0, count ?? 0));
      }
    })();
    feedbackRefreshPromiseRef.current = request;
    try {
      await request;
    } catch {
      if (feedbackRefreshScopeRef.current === requestUserId) {
        lastFeedbackRefreshAtRef.current = 0;
      }
    } finally {
      if (feedbackRefreshPromiseRef.current === request) {
        feedbackRefreshPromiseRef.current = null;
      }
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!user?.id || !isAdmin) {
      setNewFeedbackCount(0);
      return;
    }
    void refreshFeedbackCount();
    const refreshWhenVisible = () => {
      if (Platform.OS === "web" && typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshFeedbackCount();
    };
    const interval = setInterval(refreshWhenVisible, FEEDBACK_REFRESH_INTERVAL_MS);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") void refreshFeedbackCount();
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    }
    const appState = AppState.addEventListener("change", state => {
      if (state === "active") void refreshFeedbackCount();
    });
    return () => {
      clearInterval(interval);
      appState.remove();
    };
  }, [isAdmin, refreshFeedbackCount, user?.id]);

  const value = useMemo(() => ({ newFeedbackCount, refreshFeedbackCount }), [newFeedbackCount, refreshFeedbackCount]);
  return <FeedbackBadgeContext.Provider value={value}>{children}</FeedbackBadgeContext.Provider>;
}

export function useFeedbackBadge() {
  const context = useContext(FeedbackBadgeContext);
  if (!context) throw new Error("useFeedbackBadge must be used within FeedbackBadgeProvider");
  return context;
}

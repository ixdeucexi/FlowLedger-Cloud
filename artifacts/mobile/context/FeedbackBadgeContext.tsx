import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

export function FeedbackBadgeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAdmin } = useMembership();
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);

  const refreshFeedbackCount = useCallback(async () => {
    if (!user?.id || !isAdmin) {
      setNewFeedbackCount(0);
      return;
    }
    const { count, error } = await supabase
      .from("app_feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "new")
      .is("archived_at", null);
    if (!error) setNewFeedbackCount(Math.max(0, count ?? 0));
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!user?.id || !isAdmin) {
      setNewFeedbackCount(0);
      return;
    }
    void refreshFeedbackCount();
    const interval = setInterval(() => void refreshFeedbackCount(), FEEDBACK_REFRESH_INTERVAL_MS);
    const appState = AppState.addEventListener("change", state => {
      if (state === "active") void refreshFeedbackCount();
    });
    const handleFocus = () => void refreshFeedbackCount();
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
      window.addEventListener("pageshow", handleFocus);
    }
    return () => {
      clearInterval(interval);
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("pageshow", handleFocus);
      }
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

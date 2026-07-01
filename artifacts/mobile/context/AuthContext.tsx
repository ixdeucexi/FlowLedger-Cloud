import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

import { DEV_DEMO_USER_ID, disableDevDemoMode, isDevDemoMode } from "@/lib/demoMode";
import { supabase } from "@/lib/supabase";

function friendlyAuthError(message?: string | null): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (normalized.includes("provider") || normalized.includes("oauth") || normalized.includes("redirect")) {
    return "Google sign-in is almost ready, but the Google provider or redirect URL still needs to be configured in Supabase.";
  }
  return message;
}

interface AuthContextType {
  session:  Session | null;
  user:     User | null;
  loading:  boolean;
  signIn:   (email: string, password: string) => Promise<string | null>;
  signUp:   (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signOut:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [demoMode, setDemoMode] = useState(isDevDemoMode());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (demoMode) {
      const demoUser = {
        id: DEV_DEMO_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "demo@flowledger.local",
        app_metadata: {},
        user_metadata: { name: "Dev Demo" },
        created_at: new Date().toISOString(),
      } as User;
      setSession({
        access_token: "dev-demo",
        refresh_token: "dev-demo",
        expires_in: 60 * 60 * 24,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        token_type: "bearer",
        user: demoUser,
      } as Session);
      setLoading(false);
      return;
    }
    const finishInitialAuth = async () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const hasOAuthTokens = window.location.hash.includes("access_token=");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          const cleanUrl = `${window.location.origin}${window.location.pathname}`;
          window.history.replaceState({}, document.title, cleanUrl);
          if (error) console.warn("Google sign-in callback failed", error.message);
        } else if (hasOAuthTokens) {
          const cleanUrl = `${window.location.origin}${window.location.pathname}`;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    };

    finishInitialAuth().catch(error => {
      console.warn("Initial auth check failed", error);
      if (!mounted) return;
      setSession(null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [demoMode]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (demoMode) return null;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return friendlyAuthError(error?.message);
  };

  const signUp = async (email: string, password: string): Promise<string | null> => {
    if (demoMode) return null;
    const { error } = await supabase.auth.signUp({ email, password });
    return friendlyAuthError(error?.message);
  };

  const signInWithGoogle = async (): Promise<string | null> => {
    if (demoMode) return null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try { window.localStorage.setItem("flowledger_show_setup_after_login", "true"); } catch {}
    }
    const redirectTo = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/`
      : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: redirectTo ? { redirectTo } : undefined,
    });
    return friendlyAuthError(error?.message);
  };

  const signOut = async () => {
    setSession(null);
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

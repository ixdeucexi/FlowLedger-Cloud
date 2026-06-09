import { Session, User } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

interface AuthContextType {
  session:  Session | null;
  user:     User | null;
  loading:  boolean;
  signIn:   (email: string, password: string) => Promise<string | null>;
  signUp:   (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function friendlyError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "");
  if (!msg) return "Something went wrong. Please try again.";
  const l = msg.toLowerCase();
  if (l.includes("fetch") || l.includes("network") || l.includes("failed") || l.includes("typeerror"))
    return "Can't reach the server. Check your internet connection and try again.";
  if (l.includes("invalid login") || l.includes("invalid credentials"))
    return "Incorrect email or password.";
  if (l.includes("already registered") || l.includes("already exists"))
    return "An account with this email already exists. Try signing in instead.";
  if (l.includes("email not confirmed"))
    return "Please confirm your email before signing in.";
  if (l.includes("rate limit") || l.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  return msg;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => { setSession(data.session); })
      .catch(() => { setSession(null); })
      .finally(() => { setLoading(false); });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? friendlyError(error.message) : null;
    } catch (e) {
      return friendlyError(e);
    }
  };

  const signUp = async (
    email: string,
    password: string,
  ): Promise<{ error: string | null; needsConfirmation: boolean }> => {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: friendlyError(error.message), needsConfirmation: false };
      const needsConfirmation = !data.session;
      return { error: null, needsConfirmation };
    } catch (e) {
      return { error: friendlyError(e), needsConfirmation: false };
    }
  };

  const signOut = async () => {
    setSession(null);
    await supabase.auth.signOut().catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

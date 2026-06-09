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

function friendlyError(msg: string | undefined): string {
  if (!msg) return "Something went wrong. Please try again.";
  if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network"))
    return "Connection error — check your internet and try again.";
  if (msg.toLowerCase().includes("invalid login") || msg.toLowerCase().includes("invalid credentials"))
    return "Incorrect email or password.";
  if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already exists"))
    return "An account with this email already exists. Try signing in instead.";
  if (msg.toLowerCase().includes("email not confirmed"))
    return "Please confirm your email before signing in.";
  if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  return msg;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? friendlyError(error.message) : null;
  };

  const signUp = async (email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }> => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: friendlyError(error.message), needsConfirmation: false };
    // If session is null after signup, Supabase requires email confirmation
    const needsConfirmation = !data.session;
    return { error: null, needsConfirmation };
  };

  const signOut = async () => {
    // Clear session immediately so AuthObserver navigates to login right away
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

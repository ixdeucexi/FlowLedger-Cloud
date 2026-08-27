import { Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import { DEV_DEMO_USER_ID, disableDevDemoMode, enableDevDemoMode, isDevDemoMode } from "@/lib/demoMode";
import { clearLastAppRoute } from "@/lib/navigationMemory";
import { detachPushNotifications } from "@/lib/pushNotifications";
import { clearStoredSetupStep } from "@/lib/setupProgress";
import { planSimulationStoragePrefix } from "@/lib/planSimulator";
import { clearLearningTourForAccountChange } from "@/lib/learningTour";
import { supabase } from "@/lib/supabase";
import { completeSupabaseAuthUrl, nativeAuthRedirectUri, nativePasswordResetRedirectUri } from "@/lib/authLinks";
import { deactivateBillingIdentity } from "@/lib/nativeBilling";
import { apiFetch } from "@/lib/api";

WebBrowser.maybeCompleteAuthSession();

function friendlyAuthError(
  message?: string | null,
  provider?: "Google" | "Apple",
): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (provider && (normalized.includes("provider") || normalized.includes("oauth") || normalized.includes("redirect"))) {
    return `${provider} sign-in is not available yet. Its provider or redirect configuration still needs attention.`;
  }
  return message;
}

function isLiveWebHost() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const host = window.location.hostname;
  return !(host.includes("flow-ledger-cloud-git-dev-") || host === "localhost" || host === "127.0.0.1");
}

interface AuthContextType {
  session:  Session | null;
  user:     User | null;
  loading:  boolean;
  signIn:   (email: string, password: string) => Promise<string | null>;
  signUp:   (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signInWithApple: () => Promise<string | null>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signOut:  () => Promise<void>;
  demoMode: boolean;
  startDemoMode: () => void;
  stopDemoMode: () => void;
  resetDemoMode: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
function isAuthCallbackUrl(url?: string | null) {
  return Boolean(url && (
    /^flowledger:\/\/auth\/(?:callback|reset-password)/i.test(url)
    || /^https:\/\/flowledger-algo\.com\/auth\/(?:callback|reset-password)/i.test(url)
  ));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sessionsMateriallyEqual(current: Session | null, next: Session | null) {
  if (current === next) return true;
  if (!current || !next) return current === next;
  return current.access_token === next.access_token
    && current.refresh_token === next.refresh_token
    && current.expires_at === next.expires_at
    && current.user.id === next.user.id
    && current.user.updated_at === next.user.updated_at;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [demoMode, setDemoMode] = useState(isDevDemoMode());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (demoMode) {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const host = window.location.hostname;
        const isDevHost = host.includes("flow-ledger-cloud-git-dev-") || host === "localhost" || host === "127.0.0.1";
        if (!isDevHost) {
          void withTimeout(supabase.auth.getSession(), 8000, "Live session check before demo")
            .then(({ data }) => {
              if (!mounted) return;
              if (data.session) {
                disableDevDemoMode();
                setDemoMode(false);
                return;
              }
              createDemoSession();
            })
            .catch(() => {
              if (!mounted) return;
              createDemoSession();
            });
          return () => {
            mounted = false;
          };
        }
      }
      createDemoSession();
      return;
    }

    function createDemoSession() {
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
    }

    const finishInitialAuth = async () => {
      let shouldCleanWebAuthUrl = false;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        shouldCleanWebAuthUrl = params.has("code")
          || params.has("error")
          || params.has("error_description")
          || window.location.hash.includes("access_token=")
          || window.location.hash.includes("error=");
      }

      if (Platform.OS !== "web") {
        const initialUrl = await withTimeout(Linking.getInitialURL(), 3000, "Initial app link").catch(error => {
          console.warn("Initial app link check skipped", error);
          return null;
        });
        if (isAuthCallbackUrl(initialUrl)) await completeSupabaseAuthUrl(initialUrl!);
      }

      const { data } = await withTimeout(supabase.auth.getSession(), 8000, "Session check");
      // auth-js owns detectSessionInUrl and completes the browser PKCE exchange
      // during client initialization. Clean the callback only after getSession
      // has awaited that initialization; a second manual exchange consumes the
      // one-time code twice and creates false callback failures.
      if (shouldCleanWebAuthUrl && typeof window !== "undefined") {
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState({}, document.title, cleanUrl);
      }
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

    const applySession = (nextSession: Session | null) => {
      setSession(current => sessionsMateriallyEqual(current, nextSession) ? current : nextSession);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") void clearLearningTourForAccountChange();
      applySession(s);
      setLoading(false);
    });

    let resumeSessionPromise: Promise<void> | null = null;
    const refreshNativeSession = () => {
      if (resumeSessionPromise) return resumeSessionPromise;
      resumeSessionPromise = withTimeout(supabase.auth.getSession(), 8000, "Resume session check")
        .then(({ data }) => {
          if (!mounted) return;
          applySession(data.session);
          setLoading(false);
        })
        .catch(error => {
          console.warn("Resume auth check failed", error);
          if (!mounted) return;
          setLoading(false);
        })
        .finally(() => {
          resumeSessionPromise = null;
        });
      return resumeSessionPromise;
    };
    // Supabase Auth already owns browser visibility recovery when
    // autoRefreshToken is enabled. Only native needs an AppState bridge.
    const appStateSubscription = Platform.OS === "web"
      ? null
      : AppState.addEventListener("change", state => {
          if (state === "active") void refreshNativeSession();
        });
    const linkingSubscription = Platform.OS === "web" ? null : Linking.addEventListener("url", event => {
      if (!isAuthCallbackUrl(event.url)) return;
      void completeSupabaseAuthUrl(event.url)
        .then(nextSession => {
          if (!mounted || !nextSession) return;
          setSession(nextSession);
          setLoading(false);
        })
        .catch(error => console.warn("Native auth callback failed", error));
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      appStateSubscription?.remove();
      linkingSubscription?.remove();
    };
  }, [demoMode]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
      setSession(null);
      setLoading(true);
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      setSession(data.session);
      setLoading(false);
    }
    return friendlyAuthError(error?.message);
  };

  const signUp = async (email: string, password: string): Promise<string | null> => {
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
      setSession(null);
      setLoading(true);
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (!error && data.session) {
      setSession(data.session);
      setLoading(false);
      return null;
    }
    if (!error && !data.session) {
      const fallback = await supabase.auth.signInWithPassword({ email, password });
      if (!fallback.error && fallback.data.session) {
        setSession(fallback.data.session);
        setLoading(false);
        return null;
      }
      setLoading(false);
      const fallbackMessage = fallback.error?.message?.toLowerCase().includes("email")
        ? "Account created. Please confirm your email, then sign in to start setup."
        : fallback.error?.message;
      return friendlyAuthError(fallbackMessage);
    }
    setLoading(false);
    return friendlyAuthError(error?.message);
  };

  const signInWithGoogle = async (): Promise<string | null> => {
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
      setSession(null);
      setLoading(true);
    }
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        clearStoredSetupStep();
        window.localStorage.setItem("flowledger_show_setup_after_login", "true");
      } catch {}
    }
    const redirectTo = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/`
      : nativeAuthRedirectUri;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: Platform.OS !== "web",
        scopes: "https://www.googleapis.com/auth/userinfo.email",
      },
    });
    if (error) return friendlyAuthError(error.message, "Google");
    if (Platform.OS === "web") return null;
    if (!data.url) return "Google sign-in could not be started.";
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") {
      setLoading(false);
      return result.type === "cancel" || result.type === "dismiss"
        ? "Google sign-in was canceled."
        : "Google sign-in could not be completed.";
    }
    try {
      const nextSession = await completeSupabaseAuthUrl(result.url);
      if (!nextSession) return "Google sign-in returned without a session.";
      setSession(nextSession);
      setLoading(false);
      return null;
    } catch (nativeError) {
      setLoading(false);
      return friendlyAuthError(nativeError instanceof Error ? nativeError.message : "Google sign-in could not be completed.", "Google");
    }
  };

  const requestPasswordReset = async (email: string): Promise<string | null> => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return "Enter your email first, then try again.";
    const redirectTo = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/auth/reset-password`
      : nativePasswordResetRedirectUri;
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
    return friendlyAuthError(error?.message);
  };

  const signInWithApple = async (): Promise<string | null> => {
    if (Platform.OS !== "ios") return "Apple sign-in is available on iPhone and iPad.";
    if (process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED !== "true") {
      return "Apple sign-in is not available in this release.";
    }
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
      setSession(null);
      setLoading(true);
    }
    let appleSessionCreated = false;
    try {
      const nonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        nonce: hashedNonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("Apple sign-in returned without a secure identity token.");
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
        nonce,
      });
      if (error) throw error;
      appleSessionCreated = Boolean(data.session);
      if (!credential.authorizationCode || !data.session?.access_token) throw new Error("Apple sign-in returned without a revocable authorization.");
      const retention = await apiFetch("/api/account/apple-authorization", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: credential.authorizationCode }),
      });
      if (!retention.ok) {
        throw new Error("Apple sign-in could not be completed securely. Try again.");
      }
      const givenName = credential.fullName?.givenName?.trim() || null;
      const familyName = credential.fullName?.familyName?.trim() || null;
      const fullName = [givenName, familyName].filter(Boolean).join(" ");
      if (fullName) {
        await supabase.auth.updateUser({ data: { full_name: fullName, given_name: givenName, family_name: familyName } });
      }
      setSession((await supabase.auth.getSession()).data.session ?? data.session);
      setLoading(false);
      return null;
    } catch (appleError) {
      if (appleSessionCreated) {
        setSession(null);
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      }
      setLoading(false);
      const code = typeof appleError === "object" && appleError && "code" in appleError ? String(appleError.code) : "";
      if (code === "ERR_REQUEST_CANCELED") return "Apple sign-in was canceled.";
      return friendlyAuthError(appleError instanceof Error ? appleError.message : "Apple sign-in could not be completed.", "Apple");
    }
  };

  const updatePassword = async (password: string): Promise<string | null> => {
    if (password.length < 8) return "Use at least 8 characters for your new password.";
    const { error } = await supabase.auth.updateUser({ password });
    return friendlyAuthError(error?.message);
  };

  const signOut = async () => {
    deactivateBillingIdentity();
    if (session?.access_token) {
      await detachPushNotifications(session.access_token).catch(error => {
        console.warn("Server notification detach failed; native registration was invalidated locally.", error);
      });
    }
    const signedOutUserId = session?.user.id;
    setSession(null);
    await clearLastAppRoute(signedOutUserId);
    await clearLearningTourForAccountChange();
    if (signedOutUserId) {
      const prefix = planSimulationStoragePrefix(signedOutUserId);
      const simulatorDraftKeys = await AsyncStorage.getAllKeys()
        .then(keys => keys.filter(key => key.startsWith(prefix)))
        .catch(() => [] as string[]);
      if (simulatorDraftKeys.length) await AsyncStorage.multiRemove(simulatorDraftKeys).catch(() => undefined);
    }
    if (demoMode) {
      disableDevDemoMode();
      setDemoMode(false);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const startDemoMode = () => {
    if (isLiveWebHost()) {
      disableDevDemoMode();
      setDemoMode(false);
      return;
    }
    enableDevDemoMode();
    setDemoMode(true);
  };

  const stopDemoMode = () => {
    disableDevDemoMode();
    setSession(null);
    setDemoMode(false);
    setLoading(true);
  };

  const resetDemoMode = () => {
    if (isLiveWebHost()) {
      disableDevDemoMode();
      setDemoMode(false);
      return;
    }
    enableDevDemoMode();
    setSession(null);
    setDemoMode(false);
    setLoading(true);
    setTimeout(() => setDemoMode(true), 0);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signInWithGoogle, signInWithApple, requestPasswordReset, updatePassword, signOut, demoMode, startDemoMode, stopDemoMode, resetDemoMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

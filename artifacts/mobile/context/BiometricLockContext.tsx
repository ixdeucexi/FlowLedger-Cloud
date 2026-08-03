import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  biometricLockStorageKey,
  friendlyBiometricError,
  parseStoredBiometricLock,
  shouldLockAfterBackground,
  type StoredBiometricLock,
} from "@/lib/biometricLock";
import { supabase } from "@/lib/supabase";

interface BiometricLockContextValue {
  ready: boolean;
  supported: boolean;
  enabled: boolean;
  locked: boolean;
  busy: boolean;
  error: string | null;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  unlock: () => Promise<boolean>;
  lockNow: () => void;
  clearError: () => void;
}

const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

async function canUsePlatformPasskeys(): Promise<boolean> {
  if (
    Platform.OS !== "web"
    || typeof window === "undefined"
    || typeof window.PublicKeyCredential === "undefined"
    || !navigator.credentials
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function BiometricLockProvider({ children }: { children: React.ReactNode }) {
  const { user, demoMode } = useAuth();
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [storedLock, setStoredLock] = useState<StoredBiometricLock | null>(null);
  const [supported, setSupported] = useState(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const userId = demoMode ? null : user?.id ?? null;
  const ready = userId === null || loadedUserId === userId;
  const enabled = ready && storedLock?.userId === userId;

  useEffect(() => {
    let active = true;
    if (!userId) {
      setLoadedUserId(null);
      setStoredLock(null);
      setSupported(false);
      setLocked(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setLoadedUserId(null);
    setLocked(true);
    setError(null);
    void Promise.all([
      AsyncStorage.getItem(biometricLockStorageKey(userId)),
      canUsePlatformPasskeys(),
    ]).then(([saved, deviceSupported]) => {
      if (!active) return;
      const parsed = parseStoredBiometricLock(saved, userId);
      setStoredLock(parsed);
      setSupported(deviceSupported);
      setLocked(Boolean(parsed));
      setLoadedUserId(userId);
    }).catch(() => {
      if (!active) return;
      setStoredLock(null);
      setSupported(false);
      setLocked(false);
      setLoadedUserId(userId);
    });

    return () => {
      active = false;
    };
  }, [userId]);

  const noteBackgrounded = useCallback(() => {
    backgroundedAt.current = Date.now();
  }, []);

  const lockIfNeeded = useCallback(() => {
    if (enabled && shouldLockAfterBackground(backgroundedAt.current, Date.now())) {
      setLocked(true);
      setError(null);
    }
    backgroundedAt.current = null;
  }, [enabled]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", state => {
      if (state === "active") lockIfNeeded();
      else noteBackgrounded();
    });

    if (Platform.OS === "web" && typeof document !== "undefined" && typeof window !== "undefined") {
      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") noteBackgrounded();
        else lockIfNeeded();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", noteBackgrounded);
      window.addEventListener("pageshow", lockIfNeeded);
      return () => {
        appStateSubscription.remove();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", noteBackgrounded);
        window.removeEventListener("pageshow", lockIfNeeded);
      };
    }

    return () => appStateSubscription.remove();
  }, [lockIfNeeded, noteBackgrounded]);

  const enable = useCallback(async () => {
    if (!userId || !supported || busy) return false;
    setBusy(true);
    setError(null);
    let createdPasskeyId: string | null = null;
    try {
      const { data, error: registrationError } = await supabase.auth.registerPasskey();
      if (registrationError) throw registrationError;
      if (!data?.id) throw new Error("Passkey registration did not finish");
      createdPasskeyId = data.id;
      const next: StoredBiometricLock = {
        version: 1,
        enabled: true,
        userId,
        passkeyId: data.id,
      };
      await AsyncStorage.setItem(biometricLockStorageKey(userId), JSON.stringify(next));
      setStoredLock(next);
      setLocked(false);
      return true;
    } catch (caught) {
      if (createdPasskeyId) {
        await supabase.auth.passkey.delete({ passkeyId: createdPasskeyId }).catch(() => undefined);
      }
      setError(friendlyBiometricError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, supported, userId]);

  const disable = useCallback(async () => {
    if (!userId || !storedLock || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const { error: deletionError } = await supabase.auth.passkey.delete({ passkeyId: storedLock.passkeyId });
      if (deletionError && !deletionError.message.toLowerCase().includes("credential_not_found")) {
        throw deletionError;
      }
      await AsyncStorage.removeItem(biometricLockStorageKey(userId));
      setStoredLock(null);
      setLocked(false);
      return true;
    } catch (caught) {
      setError(friendlyBiometricError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, storedLock, userId]);

  const unlock = useCallback(async () => {
    if (!userId || !enabled || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const expectedUserId = userId;
      const { data, error: authenticationError } = await supabase.auth.signInWithPasskey();
      if (authenticationError) throw authenticationError;
      if (data.user?.id !== expectedUserId) {
        await supabase.auth.signOut();
        throw new Error("This passkey belongs to a different FlowLedger account");
      }
      setLocked(false);
      backgroundedAt.current = null;
      return true;
    } catch (caught) {
      setError(friendlyBiometricError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, userId]);

  const lockNow = useCallback(() => {
    if (!enabled) return;
    setError(null);
    setLocked(true);
  }, [enabled]);

  const value = useMemo<BiometricLockContextValue>(() => ({
    ready,
    supported,
    enabled,
    locked: enabled && locked,
    busy,
    error,
    enable,
    disable,
    unlock,
    lockNow,
    clearError: () => setError(null),
  }), [busy, disable, enable, enabled, error, lockNow, locked, ready, supported, unlock]);

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock() {
  const value = useContext(BiometricLockContext);
  if (!value) throw new Error("useBiometricLock must be used inside BiometricLockProvider");
  return value;
}

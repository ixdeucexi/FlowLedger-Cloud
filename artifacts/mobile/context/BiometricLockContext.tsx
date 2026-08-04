import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  assertionHasUserVerification,
  biometricLockStorageKey,
  credentialIdFromBase64Url,
  credentialIdToBase64Url,
  friendlyBiometricError,
  parseStoredBiometricLock,
  shouldLockAfterBackground,
  type StoredBiometricLock,
} from "@/lib/biometricLock";

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

function randomChallenge(): ArrayBuffer {
  const challenge = new Uint8Array(32);
  globalThis.crypto.getRandomValues(challenge);
  return challenge.buffer as ArrayBuffer;
}

async function registerDeviceCredential(userId: string, userLabel: string): Promise<string> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: "FlowLedger" },
      user: {
        id: new TextEncoder().encode(userId).buffer as ArrayBuffer,
        name: userLabel,
        displayName: userLabel,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Credential not found");
  return credentialIdToBase64Url(credential.rawId);
}

async function verifyDeviceCredential(credentialId: string): Promise<void> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{
        id: credentialIdFromBase64Url(credentialId),
        type: "public-key",
      }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Credential not found");
  if (credentialIdToBase64Url(credential.rawId) !== credentialId) throw new Error("Credential not found");
  if (!(credential.response instanceof AuthenticatorAssertionResponse)) throw new Error("Credential not found");
  if (!assertionHasUserVerification(credential.response)) throw new Error("Device verification was not completed");
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
  const unlockAttempt = useRef<Promise<boolean> | null>(null);
  const userId = demoMode ? null : user?.id ?? null;
  const userLabel = user?.email ?? "FlowLedger user";
  const ready = userId === null || loadedUserId === userId;
  const enabled = ready && storedLock?.userId === userId && storedLock.enabled;

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
      setLocked(Boolean(parsed?.enabled));
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

  const saveLock = useCallback(async (next: StoredBiometricLock) => {
    await AsyncStorage.setItem(biometricLockStorageKey(next.userId), JSON.stringify(next));
    setStoredLock(next);
  }, []);

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
    try {
      let credentialId = storedLock?.credentialId;
      if (credentialId) await verifyDeviceCredential(credentialId);
      else credentialId = await registerDeviceCredential(userId, userLabel);
      await saveLock({ version: 2, enabled: true, userId, credentialId });
      setLocked(false);
      return true;
    } catch (caught) {
      setError(friendlyBiometricError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, saveLock, storedLock?.credentialId, supported, userId, userLabel]);

  const disable = useCallback(async () => {
    if (!userId || !storedLock || busy) return false;
    setBusy(true);
    setError(null);
    try {
      await saveLock({ ...storedLock, enabled: false });
      setLocked(false);
      return true;
    } catch (caught) {
      setError(friendlyBiometricError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, saveLock, storedLock, userId]);

  const unlock = useCallback((): Promise<boolean> => {
    if (unlockAttempt.current) return unlockAttempt.current;
    if (!enabled || !storedLock) return Promise.resolve(false);

    const attempt = (async () => {
      setBusy(true);
      setError(null);
      try {
        await verifyDeviceCredential(storedLock.credentialId);
        setLocked(false);
        backgroundedAt.current = null;
        return true;
      } catch (caught) {
        setError(friendlyBiometricError(caught));
        return false;
      } finally {
        setBusy(false);
      }
    })();

    unlockAttempt.current = attempt;
    void attempt.then(() => {
      if (unlockAttempt.current === attempt) unlockAttempt.current = null;
    });
    return attempt;
  }, [enabled, storedLock]);

  const lockNow = useCallback(() => {
    if (!enabled) return;
    setError(null);
    setLocked(true);
  }, [enabled]);

  const clearError = useCallback(() => setError(null), []);
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
    clearError,
  }), [busy, clearError, disable, enable, enabled, error, lockNow, locked, ready, supported, unlock]);

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock() {
  const value = useContext(BiometricLockContext);
  if (!value) throw new Error("useBiometricLock must be used inside BiometricLockProvider");
  return value;
}

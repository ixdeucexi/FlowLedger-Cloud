import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  assertionHasUserVerification,
  biometricRpIdForHostname,
  biometricLockStorageKey,
  BIOMETRIC_UNLOCK_REUSE_MS,
  credentialIdFromBase64Url,
  credentialIdToBase64Url,
  friendlyBiometricError,
  parseRecentBiometricUnlock,
  parseStoredBiometricLock,
  recentBiometricUnlockStorageKey,
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

let sharedUnlockAttempt: { credentialId: string; promise: Promise<boolean> } | null = null;
let recentSuccessfulUnlock: { credentialId: string; completedAt: number } | null = null;
const NATIVE_DEVICE_CREDENTIAL_ID = "native-device-authentication";

function readRecentBrowserUnlock(userId: string, credentialId: string): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return Boolean(parseRecentBiometricUnlock(
      window.localStorage.getItem(recentBiometricUnlockStorageKey(userId)),
      userId,
      credentialId,
    ));
  } catch {
    return false;
  }
}

function rememberRecentBrowserUnlock(userId: string, credentialId: string, completedAt: number): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recentBiometricUnlockStorageKey(userId), JSON.stringify({
      version: 1,
      userId,
      credentialId,
      completedAt,
    }));
  } catch {}
}

function clearRecentBrowserUnlock(userId: string): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recentBiometricUnlockStorageKey(userId));
  } catch {}
}

async function withCrossDocumentBiometricLock<T>(credentialId: string, task: () => Promise<T>): Promise<T> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.locks) {
    return task();
  }
  return navigator.locks.request(`flowledger-biometric:${credentialId}`, task);
}

async function canUsePlatformPasskeys(): Promise<boolean> {
  if (Platform.OS !== "web") {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  }
  if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined" || !navigator.credentials) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function verifyNativeDeviceCredential(promptMessage: string): Promise<void> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    promptSubtitle: "Protect your FlowLedger plan",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  if (!result.success) throw new Error(result.error || "Device unlock was cancelled");
}

function randomChallenge(): ArrayBuffer {
  const challenge = new Uint8Array(32);
  globalThis.crypto.getRandomValues(challenge);
  return challenge.buffer as ArrayBuffer;
}

function currentBiometricRpId(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  return biometricRpIdForHostname(window.location.hostname);
}

async function registerDeviceCredential(userId: string, userLabel: string): Promise<string> {
  const rpId = currentBiometricRpId();
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: "FlowLedger", ...(rpId ? { id: rpId } : {}) },
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
  const rpId = currentBiometricRpId();
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      ...(rpId ? { rpId } : {}),
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
      const recentlyUnlocked = Boolean(parsed?.enabled && readRecentBrowserUnlock(userId, parsed.credentialId));
      setLocked(Boolean(parsed?.enabled && !recentlyUnlocked));
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
    if (sharedUnlockAttempt) return;
    backgroundedAt.current = Date.now();
  }, []);

  const lockIfNeeded = useCallback(() => {
    if (sharedUnlockAttempt) {
      backgroundedAt.current = null;
      return;
    }
    if (enabled && shouldLockAfterBackground(backgroundedAt.current, Date.now())) {
      if (userId) clearRecentBrowserUnlock(userId);
      recentSuccessfulUnlock = null;
      setLocked(true);
      setError(null);
    }
    backgroundedAt.current = null;
  }, [enabled, userId]);

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
      let credentialId: string;
      if (Platform.OS === "web") {
        credentialId = storedLock?.credentialId ?? await registerDeviceCredential(userId, userLabel);
        if (storedLock?.credentialId) await verifyDeviceCredential(credentialId);
      } else {
        await verifyNativeDeviceCredential("Turn on device lock");
        credentialId = NATIVE_DEVICE_CREDENTIAL_ID;
      }
      await saveLock({ version: 2, enabled: true, userId, credentialId });
      const completedAt = Date.now();
      recentSuccessfulUnlock = { credentialId, completedAt };
      rememberRecentBrowserUnlock(userId, credentialId, completedAt);
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
      clearRecentBrowserUnlock(userId);
      recentSuccessfulUnlock = null;
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
    if (!enabled || !storedLock) return Promise.resolve(false);
    const credentialId = storedLock.credentialId;
    if (
      recentSuccessfulUnlock?.credentialId === credentialId
      && Date.now() - recentSuccessfulUnlock.completedAt < BIOMETRIC_UNLOCK_REUSE_MS
    ) {
      setLocked(false);
      backgroundedAt.current = null;
      return Promise.resolve(true);
    }
    if (userId && readRecentBrowserUnlock(userId, credentialId)) {
      recentSuccessfulUnlock = { credentialId, completedAt: Date.now() };
      setLocked(false);
      backgroundedAt.current = null;
      return Promise.resolve(true);
    }
    if (sharedUnlockAttempt?.credentialId === credentialId) {
      setBusy(true);
      return sharedUnlockAttempt.promise.then(unlocked => {
        if (unlocked) {
          setLocked(false);
          backgroundedAt.current = null;
        }
        return unlocked;
      }).finally(() => setBusy(false));
    }

    const attempt = (async () => {
      setBusy(true);
      setError(null);
      try {
        await withCrossDocumentBiometricLock(credentialId, async () => {
          if (userId && readRecentBrowserUnlock(userId, credentialId)) return;
          if (Platform.OS === "web") await verifyDeviceCredential(credentialId);
          else await verifyNativeDeviceCredential("Unlock FlowLedger");
          const completedAt = Date.now();
          recentSuccessfulUnlock = { credentialId, completedAt };
          if (userId) rememberRecentBrowserUnlock(userId, credentialId, completedAt);
        });
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

    sharedUnlockAttempt = { credentialId, promise: attempt };
    void attempt.then(() => {
      if (sharedUnlockAttempt?.promise === attempt) sharedUnlockAttempt = null;
    });
    return attempt;
  }, [enabled, storedLock, userId]);

  const lockNow = useCallback(() => {
    if (!enabled) return;
    if (userId) clearRecentBrowserUnlock(userId);
    recentSuccessfulUnlock = null;
    setError(null);
    setLocked(true);
  }, [enabled, userId]);

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

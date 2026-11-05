import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/context/AuthContext";
import {
  assertionHasUserVerification,
  biometricRpIdForHostname,
  biometricLockStorageKey,
  biometricLockTimeout,
  isBiometricLockTimeout,
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
  timeoutMs: number;
  setAutoLockDelay: (timeoutMs: number) => Promise<boolean>;
}

const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

interface BiometricLockScope { userId: string | null; generation: number; }
let sharedUnlockAttempt: { scope: BiometricLockScope; userId: string; credentialId: string; promise: Promise<boolean> } | null = null;
let recentSuccessfulUnlock: { userId: string; credentialId: string; completedAt: number } | null = null;
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

async function withCrossDocumentBiometricLock<T>(userId: string, credentialId: string, task: () => Promise<T>): Promise<T> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.locks) {
    return task();
  }
  return navigator.locks.request(`flowledger-biometric:${userId}:${credentialId}`, task);
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
  const currentLockRef = useRef<StoredBiometricLock | null>(null);
  const mountedRef = useRef(true);
  const userId = demoMode ? null : user?.id ?? null;
  const userLabel = user?.email ?? "FlowLedger user";
  const scopeRef = useRef<BiometricLockScope>({ userId, generation: 0 });
  const busyScopeRef = useRef<BiometricLockScope | null>(null);
  const authenticationScopeRef = useRef<BiometricLockScope | null>(null);
  if (scopeRef.current.userId !== userId) {
    scopeRef.current = { userId, generation: scopeRef.current.generation + 1 };
    currentLockRef.current = null;
    backgroundedAt.current = null;
  }
  const ready = userId === null || loadedUserId === userId;
  const enabled = ready && storedLock?.userId === userId && storedLock.enabled;
  const timeoutMs = biometricLockTimeout(storedLock?.userId === userId ? storedLock.timeoutMs : undefined);
  const isCurrentScope = useCallback((scope: BiometricLockScope) => (
    mountedRef.current && scopeRef.current === scope
  ), []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const scope = scopeRef.current;
    currentLockRef.current = null;
    backgroundedAt.current = null;
    busyScopeRef.current = null;
    setBusy(false);
    if (recentSuccessfulUnlock?.userId !== userId) recentSuccessfulUnlock = null;
    if (!userId) {
      setLoadedUserId(null);
      setStoredLock(null);
      setSupported(false);
      setLocked(false);
      setError(null);
      return () => { active = false; };
    }

    setLoadedUserId(null);
    setLocked(true);
    setError(null);
    void Promise.all([
      AsyncStorage.getItem(biometricLockStorageKey(userId)),
      canUsePlatformPasskeys(),
    ]).then(([saved, deviceSupported]) => {
      if (!active || !isCurrentScope(scope)) return;
      const parsed = parseStoredBiometricLock(saved, userId);
      currentLockRef.current = parsed;
      setStoredLock(parsed);
      setSupported(deviceSupported);
      const recentlyUnlocked = Boolean(parsed?.enabled && readRecentBrowserUnlock(userId, parsed.credentialId));
      setLocked(Boolean(parsed?.enabled && !recentlyUnlocked));
      setLoadedUserId(userId);
    }).catch(() => {
      if (!active || !isCurrentScope(scope)) return;
      currentLockRef.current = null;
      setStoredLock(null);
      setSupported(false);
      setLocked(false);
      setLoadedUserId(userId);
    });

    return () => { active = false; };
  }, [isCurrentScope, userId]);

  const beginOperation = useCallback((scope: BiometricLockScope) => {
    if (!isCurrentScope(scope) || busyScopeRef.current === scope) return false;
    busyScopeRef.current = scope;
    setBusy(true);
    setError(null);
    return true;
  }, [isCurrentScope]);
  const finishOperation = useCallback((scope: BiometricLockScope) => {
    if (busyScopeRef.current !== scope) return;
    busyScopeRef.current = null;
    if (isCurrentScope(scope)) setBusy(false);
  }, [isCurrentScope]);

  const saveLock = useCallback(async (next: StoredBiometricLock, scope: BiometricLockScope) => {
    if (!isCurrentScope(scope) || next.userId !== scope.userId) return false;
    await AsyncStorage.setItem(biometricLockStorageKey(next.userId), JSON.stringify(next));
    if (!isCurrentScope(scope)) return false;
    currentLockRef.current = next;
    setStoredLock(next);
    return true;
  }, [isCurrentScope]);

  const noteBackgrounded = useCallback(() => {
    // Native/WebAuthn prompts may themselves background the app.
    if (sharedUnlockAttempt?.scope === scopeRef.current || authenticationScopeRef.current === scopeRef.current) return;
    backgroundedAt.current = Date.now();
  }, []);

  const lockIfNeeded = useCallback(() => {
    if (sharedUnlockAttempt?.scope === scopeRef.current || authenticationScopeRef.current === scopeRef.current) {
      backgroundedAt.current = null;
      return;
    }
    if (enabled && shouldLockAfterBackground(backgroundedAt.current, Date.now(), timeoutMs)) {
      if (userId) clearRecentBrowserUnlock(userId);
      recentSuccessfulUnlock = null;
      setLocked(true);
      setError(null);
    }
    backgroundedAt.current = null;
  }, [enabled, timeoutMs, userId]);

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
    const scope = scopeRef.current;
    if (!userId || !ready || !supported || scope.userId !== userId) return false;
    if (currentLockRef.current?.enabled) return true;
    if (!beginOperation(scope)) return false;
    authenticationScopeRef.current = scope;
    try {
      const previous = currentLockRef.current;
      let credentialId: string;
      if (Platform.OS === "web") {
        credentialId = previous?.credentialId ?? await registerDeviceCredential(userId, userLabel);
        if (!isCurrentScope(scope)) return false;
        if (previous?.credentialId) await verifyDeviceCredential(credentialId);
      } else {
        await verifyNativeDeviceCredential("Turn on App Lock");
        credentialId = NATIVE_DEVICE_CREDENTIAL_ID;
      }
      if (!isCurrentScope(scope)) return false;
      if (!await saveLock({ version: 2, enabled: true, userId, credentialId, timeoutMs: biometricLockTimeout(previous?.timeoutMs) }, scope)) return false;
      const completedAt = Date.now();
      recentSuccessfulUnlock = { userId, credentialId, completedAt };
      rememberRecentBrowserUnlock(userId, credentialId, completedAt);
      setLocked(false);
      backgroundedAt.current = null;
      return true;
    } catch (caught) {
      if (isCurrentScope(scope)) setError(friendlyBiometricError(caught));
      return false;
    } finally {
      if (authenticationScopeRef.current === scope) authenticationScopeRef.current = null;
      finishOperation(scope);
    }
  }, [beginOperation, finishOperation, isCurrentScope, ready, saveLock, supported, userId, userLabel]);

  const disable = useCallback(async () => {
    const scope = scopeRef.current;
    const current = currentLockRef.current;
    if (!userId || !ready || !current || current.userId !== userId || scope.userId !== userId) return false;
    if (!current.enabled) return true;
    if (!beginOperation(scope)) return false;
    try {
      if (!await saveLock({ ...current, enabled: false }, scope)) return false;
      clearRecentBrowserUnlock(userId);
      recentSuccessfulUnlock = null;
      setLocked(false);
      return true;
    } catch (caught) {
      if (isCurrentScope(scope)) setError(friendlyBiometricError(caught));
      return false;
    } finally {
      finishOperation(scope);
    }
  }, [beginOperation, finishOperation, isCurrentScope, ready, saveLock, userId]);

  const setAutoLockDelay = useCallback(async (nextTimeoutMs: number) => {
    const scope = scopeRef.current;
    const current = currentLockRef.current;
    // A delay edit can never create enrollment or turn an Off lock back on.
    if (!userId || !ready || !current?.enabled || current.userId !== userId || scope.userId !== userId) return false;
    if (!isBiometricLockTimeout(nextTimeoutMs)) {
      setError("Choose one of the available lock delays.");
      return false;
    }
    if (!beginOperation(scope)) return false;
    try {
      return await saveLock({ ...current, timeoutMs: nextTimeoutMs }, scope);
    } catch {
      if (isCurrentScope(scope)) setError("The lock delay could not be saved. Please try again.");
      return false;
    } finally {
      finishOperation(scope);
    }
  }, [beginOperation, finishOperation, isCurrentScope, ready, saveLock, userId]);

  const unlock = useCallback((): Promise<boolean> => {
    const scope = scopeRef.current;
    const current = currentLockRef.current;
    if (!userId || !ready || scope.userId !== userId || !current?.enabled || current.userId !== userId || !isCurrentScope(scope)) return Promise.resolve(false);
    const credentialId = current.credentialId;
    const canPublish = () => isCurrentScope(scope)
      && currentLockRef.current?.userId === userId
      && currentLockRef.current.enabled
      && currentLockRef.current.credentialId === credentialId;
    if (
      recentSuccessfulUnlock?.userId === userId
      && recentSuccessfulUnlock.credentialId === credentialId
      && Date.now() - recentSuccessfulUnlock.completedAt < BIOMETRIC_UNLOCK_REUSE_MS
    ) {
      setLocked(false);
      backgroundedAt.current = null;
      return Promise.resolve(true);
    }
    if (readRecentBrowserUnlock(userId, credentialId)) {
      recentSuccessfulUnlock = { userId, credentialId, completedAt: Date.now() };
      setLocked(false);
      backgroundedAt.current = null;
      return Promise.resolve(true);
    }
    if (sharedUnlockAttempt?.scope === scope && sharedUnlockAttempt.userId === userId && sharedUnlockAttempt.credentialId === credentialId) {
      return sharedUnlockAttempt.promise.then(unlocked => unlocked && canPublish());
    }
    if (!beginOperation(scope)) return Promise.resolve(false);
    const attempt = (async () => {
      try {
        const unlocked = await withCrossDocumentBiometricLock(userId, credentialId, async () => {
          if (!canPublish()) return false;
          if (!readRecentBrowserUnlock(userId, credentialId)) {
            if (Platform.OS === "web") await verifyDeviceCredential(credentialId);
            else await verifyNativeDeviceCredential("Unlock FlowLedger");
            if (!canPublish()) return false;
            const completedAt = Date.now();
            recentSuccessfulUnlock = { userId, credentialId, completedAt };
            rememberRecentBrowserUnlock(userId, credentialId, completedAt);
          }
          return true;
        });
        if (!unlocked || !canPublish()) return false;
        setLocked(false);
        backgroundedAt.current = null;
        return true;
      } catch (caught) {
        if (isCurrentScope(scope)) setError(friendlyBiometricError(caught));
        return false;
      } finally {
        finishOperation(scope);
      }
    })();
    sharedUnlockAttempt = { scope, userId, credentialId, promise: attempt };
    void attempt.then(() => {
      if (sharedUnlockAttempt?.promise === attempt) sharedUnlockAttempt = null;
    });
    return attempt;
  }, [beginOperation, finishOperation, isCurrentScope, ready, userId]);

  const lockNow = useCallback(() => {
    const current = currentLockRef.current;
    if (!userId || !ready || scopeRef.current.userId !== userId || !current?.enabled || current.userId !== userId || busyScopeRef.current === scopeRef.current) return;
    clearRecentBrowserUnlock(userId);
    recentSuccessfulUnlock = null;
    setError(null);
    setLocked(true);
  }, [ready, userId]);

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
    timeoutMs,
    setAutoLockDelay,
  }), [busy, clearError, disable, enable, enabled, error, lockNow, locked, ready, setAutoLockDelay, supported, timeoutMs, unlock]);

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock() {
  const value = useContext(BiometricLockContext);
  if (!value) throw new Error("useBiometricLock must be used inside BiometricLockProvider");
  return value;
}

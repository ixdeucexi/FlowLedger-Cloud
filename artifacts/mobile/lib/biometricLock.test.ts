import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit, ScriptTarget } from "typescript";
import * as lockHelpers from "./biometricLock";

import {
  BIOMETRIC_LOCK_TIMEOUT_MS,
  BIOMETRIC_LOCK_DELAY_OPTIONS,
  BIOMETRIC_UNLOCK_REUSE_MS,
  assertionHasUserVerification,
  biometricRpIdForHostname,
  biometricLockStorageKey,
  biometricLockTimeout,
  credentialIdFromBase64Url,
  credentialIdToBase64Url,
  friendlyBiometricError,
  parseRecentBiometricUnlock,
  parseStoredBiometricLock,
  recentBiometricUnlockStorageKey,
  shouldLockAfterBackground,
} from "./biometricLock";

describe("biometric app lock", () => {
  it("keeps device settings isolated by user", () => {
    assert.equal(biometricLockStorageKey("user-a"), "flowledger_biometric_lock:v2:user-a");
    assert.notEqual(biometricLockStorageKey("user-a"), biometricLockStorageKey("user-b"));
  });

  it("binds production biometrics to the canonical FlowLedger domain", () => {
    assert.equal(biometricRpIdForHostname("flowledger-algo.com"), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("www.flowledger-algo.com"), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("LOGIN.FLOWLEDGER-ALGO.COM."), "flowledger-algo.com");
    assert.equal(biometricRpIdForHostname("flow-ledger-cloud.vercel.app"), undefined);
    assert.equal(biometricRpIdForHostname("localhost"), undefined);
    assert.equal(biometricRpIdForHostname("notflowledger-algo.com"), undefined);
  });

  it("reuses only a fresh unlock for the same user and credential", () => {
    const completedAt = 10_000;
    const saved = JSON.stringify({
      version: 1,
      userId: "user-a",
      credentialId: "credential-1",
      completedAt,
    });
    assert.equal(recentBiometricUnlockStorageKey("user-a"), "flowledger_biometric_unlock:v1:user-a");
    assert.ok(parseRecentBiometricUnlock(saved, "user-a", "credential-1", completedAt + 1));
    assert.equal(parseRecentBiometricUnlock(saved, "user-b", "credential-1", completedAt + 1), null);
    assert.equal(parseRecentBiometricUnlock(saved, "user-a", "credential-2", completedAt + 1), null);
    assert.equal(
      parseRecentBiometricUnlock(saved, "user-a", "credential-1", completedAt + BIOMETRIC_UNLOCK_REUSE_MS),
      null,
    );
  });

  it("accepts only the current user's complete saved enrollment", () => {
    const saved = JSON.stringify({ version: 2, enabled: true, userId: "user-a", credentialId: "credential-1" });
    assert.deepEqual(parseStoredBiometricLock(saved, "user-a"), {
      version: 2,
      enabled: true,
      userId: "user-a",
      credentialId: "credential-1",
    });
    assert.equal(parseStoredBiometricLock(saved, "user-b"), null);
    assert.equal(parseStoredBiometricLock("not-json", "user-a"), null);
  });

  it("round-trips WebAuthn credential IDs", () => {
    const original = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    const encoded = credentialIdToBase64Url(original.buffer);
    assert.equal(encoded, "AAEC_f7_");
    assert.deepEqual(Array.from(new Uint8Array(credentialIdFromBase64Url(encoded))), Array.from(original));
  });

  it("requires the authenticator's user-verification flag", () => {
    const verified = new Uint8Array(37);
    verified[32] = 0x05;
    const unverified = new Uint8Array(37);
    unverified[32] = 0x01;
    assert.equal(assertionHasUserVerification({ authenticatorData: verified.buffer } as AuthenticatorAssertionResponse), true);
    assert.equal(assertionHasUserVerification({ authenticatorData: unverified.buffer } as AuthenticatorAssertionResponse), false);
  });

  it("locks only after two full minutes away", () => {
    assert.equal(shouldLockAfterBackground(1_000, 1_000 + BIOMETRIC_LOCK_TIMEOUT_MS - 1), false);
    assert.equal(shouldLockAfterBackground(1_000, 1_000 + BIOMETRIC_LOCK_TIMEOUT_MS), true);
  });

  it("supports every configured background delay at its exact boundary", () => {
    assert.deepEqual(BIOMETRIC_LOCK_DELAY_OPTIONS.map(option => option.value), [0, 30_000, 60_000, 120_000, 300_000]);
    for (const { value } of BIOMETRIC_LOCK_DELAY_OPTIONS) {
      if (value > 0) assert.equal(shouldLockAfterBackground(1_000, 1_000 + value - 1, value), false);
      assert.equal(shouldLockAfterBackground(1_000, 1_000 + value, value), true);
    }
    assert.equal(shouldLockAfterBackground(null, 300_000, 0), false);
  });

  it("keeps legacy enrollment and invalid delays on the two-minute default", () => {
    for (const value of [undefined, null, -1, 10, NaN, Infinity, "30000"]) assert.equal(biometricLockTimeout(value), 120_000);
    const saved = JSON.stringify({ version: 2, enabled: true, userId: "user-a", credentialId: "native-device-authentication", timeoutMs: "bad" });
    const parsed = parseStoredBiometricLock(saved, "user-a");
    assert.equal(parsed?.enabled, true);
    assert.equal(parsed?.timeoutMs, 120_000);
  });

  it("keeps biometric errors friendly", () => {
    assert.match(friendlyBiometricError(new Error("NotAllowedError: cancelled")), /cancelled/i);
    assert.doesNotMatch(friendlyBiometricError(new Error("secret internal stack")), /secret|stack/i);
  });
});

type NativeResult = { success: boolean; error?: string };
const enrollment = (userId: string, extra = {}) => ({ version: 2, enabled: true, userId, credentialId: "native-device-authentication", ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

/** Execute the real provider with isolated hooks, storage, clock and native API. */
function providerHarness(seed: Record<string, unknown> = {}, faults: {
  read?: (key: string) => Promise<string | null>;
  hardware?: () => Promise<boolean>;
  enrolled?: () => Promise<boolean>;
} = {}) {
  const storage = new Map(Object.entries(seed).map(([id, value]) => [biometricLockStorageKey(id), JSON.stringify(value)]));
  const writes: Array<{ key: string; value: string }> = [], prompts: Record<string, unknown>[] = [];
  const listeners = new Set<(value: string) => void>(), slots: any[] = [];
  let index = 0, dirty = false, now = 10_000, mounted = true;
  let auth = { user: { id: "user-a", email: "device-fixture@example.test" }, demoMode: false };
  let effects: Array<() => void> = [], result: any;
  let authenticate: () => Promise<NativeResult> = async () => ({ success: true });
  let writeGate: Promise<void> | null = null, failWrites = false;
  let read = faults.read;
  const unchanged = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react: any = {
    createContext: () => ({ Provider: "Provider" }),
    useState(initial: unknown) {
      const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (next: unknown) => { assert(mounted, "Old operation published after unmount"); const v = typeof next === "function" ? next(slots[slot]) : next; if (!Object.is(slots[slot], v)) { slots[slot] = v; dirty = true; } }];
    },
    useRef(initial: unknown) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useCallback(fn: unknown, deps: unknown[]) { const slot = index++; if (!unchanged(slots[slot]?.deps, deps)) slots[slot] = { deps, value: fn }; return slots[slot].value; },
    useMemo(fn: () => unknown, deps: unknown[]) { const slot = index++; if (!unchanged(slots[slot]?.deps, deps)) slots[slot] = { deps, value: fn() }; return slots[slot].value; },
    useEffect(fn: () => unknown, deps: unknown[]) { const slot = index++; if (unchanged(slots[slot]?.deps, deps)) return; const previous = slots[slot]; slots[slot] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[slot].cleanup?.(); slots[slot].cleanup = fn(); }); },
  };
  const code = transpileModule(readFileSync("context/BiometricLockContext.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exported: any = {};
  const requireMock = (name: string): any => {
    if (name === "react") return { __esModule: true, default: react, ...react };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    if (name === "react-native") return { Platform: { OS: "android" }, AppState: { addEventListener: (_event: string, fn: (value: string) => void) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } } };
    if (name === "@/context/AuthContext") return { useAuth: () => auth };
    if (name === "@/lib/biometricLock") return lockHelpers;
    if (name === "expo-local-authentication") return { hasHardwareAsync: faults.hardware ?? (async () => true), isEnrolledAsync: faults.enrolled ?? (async () => true), authenticateAsync: async (options: Record<string, unknown>) => { prompts.push(options); return authenticate(); } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async (key: string) => read ? read(key) : storage.get(key) ?? null, setItem: async (key: string, value: string) => { await writeGate; if (failWrites) throw new Error("Fictional storage rejection"); storage.set(key, value); writes.push({ key, value }); } } };
    throw new Error(`Unexpected provider dependency ${name}`);
  };
  class FixtureDate extends Date { static now() { return now; } }
  new Function("exports", "require", "Date", code)(exported, requireMock, FixtureDate);
  const render = () => { index = 0; dirty = false; result = exported.BiometricLockProvider({ children: null }).props.value; const pending = effects; effects = []; pending.forEach(run => run()); };
  const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty) render(); } };
  render();
  return {
    get value() { return result; }, storage, writes, prompts, flush,
    authenticateWith(fn: () => Promise<NativeResult>) { authenticate = fn; }, holdWrites(p: Promise<void> | null) { writeGate = p; }, failWrites(v: boolean) { failWrites = v; },
    readWith(fn?: (key: string) => Promise<string | null>) { read = fn; },
    user(id: string) { auth = { user: { id, email: "device-fixture@example.test" }, demoMode: false }; render(); }, state(v: string) { for (const fn of [...listeners]) fn(v); }, advance(ms: number) { now += ms; },
    close() { slots.forEach(slot => slot?.cleanup?.()); mounted = false; assert.equal(listeners.size, 0); },
  };
}

describe("App Lock provider with fictional native authentication", () => {
  it("keeps readable enabled enrollment locked when a native capability probe fails", async () => {
    for (const capability of ["hardware", "enrolled"] as const) {
      const h = providerHarness({ "user-a": enrollment("user-a") }, { [capability]: async () => { throw new Error("Fictional device probe failure"); } });
      try {
        await h.flush();
        assert.equal(h.value.ready, true); assert.equal(h.value.supported, false);
        assert.equal(h.value.enabled, true); assert.equal(h.value.locked, true);
        assert.equal(h.value.initializationError, null); assert.deepEqual(h.writes, []);
        h.authenticateWith(async () => ({ success: false, error: "user_cancel" }));
        assert.equal(await h.value.unlock(), false); await h.flush(); assert.equal(h.value.locked, true);
        h.authenticateWith(async () => ({ success: true }));
        assert.equal(await h.value.unlock(), true); await h.flush(); assert.equal(h.value.locked, false);
        assert.equal(h.prompts.length, 2); assert.deepEqual(h.writes, []);
      } finally { h.close(); }
    }
  });
  it("blocks unknown enrollment after a storage failure and retries without writes or authentication bypass", async () => {
    for (const enabled of [false, true]) {
      const h = providerHarness({ "user-a": enrollment("user-a", { enabled }) }, { read: async () => { throw new Error("Fictional storage failure"); } });
      try {
        await h.flush();
        assert.equal(h.value.ready, true); assert.equal(h.value.locked, true);
        assert.match(h.value.initializationError, /Try again or sign out/);
        assert.equal(await h.value.unlock(), false); assert.equal(await h.value.disable(), false);
        h.value.clearError(); await h.flush(); assert.equal(h.value.locked, true);
        h.value.retryLoad(); await h.flush(); assert.equal(h.value.locked, true);
        assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
        h.readWith(); h.value.retryLoad(); await h.flush();
        assert.equal(h.value.initializationError, null); assert.equal(h.value.enabled, enabled); assert.equal(h.value.locked, enabled);
        assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
      } finally { h.close(); }
    }
  });
  it("ignores a previous user's delayed lock read failure after the next user loads", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<string | null>((_resolve, fail) => { reject = fail; });
    const h = providerHarness({ "user-b": enrollment("user-b") }, { read: () => pending });
    try {
      await h.flush(); h.readWith(); h.user("user-b"); await h.flush();
      reject(new Error("Old user storage failure")); await h.flush();
      assert.equal(h.value.enabled, true); assert.equal(h.value.locked, true);
      assert.equal(h.value.initializationError, null); assert.deepEqual(h.writes, []);
    } finally { h.close(); }
  });
  it("keeps the opaque lock gate ready and locked throughout a delayed retry", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }, { read: async () => { throw new Error("Fictional storage failure"); } });
    try {
      await h.flush(); const saved = h.storage.get(biometricLockStorageKey("user-a"))!;
      for (const result of ["error", "success"] as const) {
        let resolve!: (value: string | null) => void, reject!: (error: Error) => void;
        const pending = new Promise<string | null>((yes, no) => { resolve = yes; reject = no; });
        h.readWith(() => pending); h.value.retryLoad(); await h.flush();
        assert.equal(h.value.ready, true, "the mounted modal must survive while navigation is already ready");
        assert.equal(h.value.locked, true); assert.equal(h.value.busy, true);
        assert.match(h.value.initializationError, /Try again or sign out/);
        assert.equal(await h.value.unlock(), false);
        if (result === "error") reject(new Error("Still unavailable")); else resolve(saved);
        await h.flush(); assert.equal(h.value.ready, true); assert.equal(h.value.locked, true); assert.equal(h.value.busy, false);
      }
      assert.equal(h.value.initializationError, null); assert.equal(h.value.enabled, true);
      assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
    } finally { h.close(); }
  });
  it("stays Off without writes or prompts through mount, delay edits and background events", async () => {
    const h = providerHarness(); try {
      await h.flush(); assert.equal(h.value.ready, true); assert.equal(h.value.enabled, false); assert.equal(h.value.locked, false);
      assert.equal(await h.value.setAutoLockDelay(0), false); h.value.lockNow(); assert.equal(await h.value.unlock(), false);
      h.state("background"); h.advance(500_000); h.state("active"); await h.flush();
      assert.equal(h.value.enabled, false); assert.equal(h.value.locked, false); assert.equal(h.value.timeoutMs, 120_000); assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
    } finally { h.close(); }
  });
  it("preserves explicit Off enrollment and delay without activating it", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a", { enabled: false, timeoutMs: 300_000 }) }); try {
      await h.flush(); assert.equal(h.value.enabled, false); assert.equal(h.value.timeoutMs, 300_000); assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
    } finally { h.close(); }
  });
  it("preserves legacy On enrollment with two minutes and no storage rewrite", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }); try {
      await h.flush(); assert.equal(h.value.enabled, true); assert.equal(h.value.locked, true); assert.equal(h.value.timeoutMs, 120_000); assert.deepEqual(h.writes, []); assert.deepEqual(h.prompts, []);
    } finally { h.close(); }
  });
  it("enables only after explicit successful device authentication with PIN fallback permitted", async () => {
    const h = providerHarness(); try {
      await h.flush(); assert.equal(await h.value.enable(), true); await h.flush(); assert.equal(h.prompts.length, 1); assert.equal(h.prompts[0].disableDeviceFallback, false);
      assert.equal(h.value.enabled, true); assert.equal(h.value.locked, false); assert.equal(h.value.timeoutMs, 120_000); assert.equal(JSON.parse(h.writes[0].value).enabled, true);
    } finally { h.close(); }
  });
  it("keeps canceled setup Off and accepts a later explicit retry", async () => {
    const h = providerHarness(); try {
      await h.flush(); h.authenticateWith(async () => ({ success: false, error: "user_cancel" })); assert.equal(await h.value.enable(), false); await h.flush(); assert.equal(h.value.enabled, false); assert.deepEqual(h.writes, []);
      h.authenticateWith(async () => ({ success: true })); assert.equal(await h.value.enable(), true); await h.flush(); assert.equal(h.value.enabled, true);
    } finally { h.close(); }
  });
  it("persists every allowed delay only after enrollment and retains its value when disabled", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }); try {
      await h.flush(); for (const option of BIOMETRIC_LOCK_DELAY_OPTIONS) { assert.equal(await h.value.setAutoLockDelay(option.value), true); await h.flush(); assert.equal(h.value.timeoutMs, option.value); }
      assert.equal(h.prompts.length, 0); assert.equal(await h.value.disable(), true); await h.flush(); const count = h.writes.length; assert.equal(await h.value.setAutoLockDelay(0), false); assert.equal(h.writes.length, count); assert.equal(h.value.enabled, false); assert.equal(h.value.timeoutMs, 300_000);
    } finally { h.close(); }
  });
  it("rejects invalid delays and retains confirmed settings after a failed write", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }); try {
      await h.flush(); assert.equal(await h.value.setAutoLockDelay(42), false); assert.deepEqual(h.writes, []);
      h.failWrites(true); assert.equal(await h.value.setAutoLockDelay(0), false); await h.flush(); assert.equal(h.value.timeoutMs, 120_000); assert.match(h.value.error, /could not be saved/);
      h.failWrites(false); assert.equal(await h.value.setAutoLockDelay(0), true); await h.flush(); assert.equal(h.value.timeoutMs, 0); assert.equal(h.value.error, null);
    } finally { h.close(); }
  });
  it("relocks at the selected boundary and does not reuse recent unlock after Lock now or Immediate", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a", { timeoutMs: 30_000 }) }); try {
      await h.flush(); await h.value.unlock(); await h.flush(); assert.equal(h.prompts.length, 1);
      h.state("background"); h.advance(29_999); h.state("active"); await h.flush(); assert.equal(h.value.locked, false);
      h.state("background"); h.advance(30_000); h.state("active"); await h.flush(); assert.equal(h.value.locked, true); await h.value.unlock(); await h.flush(); assert.equal(h.prompts.length, 2);
      h.value.lockNow(); await h.flush(); assert.equal(h.value.locked, true); await h.value.unlock(); await h.flush(); assert.equal(h.prompts.length, 3);
      await h.value.setAutoLockDelay(0); await h.flush(); h.state("background"); h.state("active"); await h.flush(); assert.equal(h.value.locked, true); await h.value.unlock(); await h.flush(); assert.equal(h.prompts.length, 4);
    } finally { h.close(); }
  });
  it("coalesces rapid unlocks and ignores background events from the authentication prompt", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a", { timeoutMs: 0 }) }); try {
      await h.flush(); const auth = deferred<NativeResult>(); h.authenticateWith(() => auth.promise); const first = h.value.unlock(), second = h.value.unlock(); await h.flush(); assert.equal(h.prompts.length, 1);
      h.state("background"); h.advance(100_000); h.state("active"); auth.resolve({ success: true }); assert.deepEqual(await Promise.all([first, second]), [true, true]); await h.flush(); assert.equal(h.value.locked, false); assert.equal(h.value.busy, false);
    } finally { h.close(); }
  });
  it("discards setup authentication completed for a previous signed-in user", async () => {
    const h = providerHarness(); try {
      await h.flush(); const auth = deferred<NativeResult>(); h.authenticateWith(() => auth.promise); const pending = h.value.enable(); await h.flush(); h.user("user-b"); await h.flush(); auth.resolve({ success: true });
      assert.equal(await pending, false); await h.flush(); assert.equal(h.value.enabled, false); assert.equal(h.value.busy, false); assert.deepEqual(h.writes, []);
    } finally { h.close(); }
  });
  it("does not publish a previous user's delayed write into the current user's enabled lock", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a"), "user-b": enrollment("user-b", { timeoutMs: 300_000 }) }); try {
      await h.flush(); const write = deferred<void>(); h.holdWrites(write.promise); const pending = h.value.disable(); await h.flush(); h.user("user-b"); await h.flush(); write.resolve(); assert.equal(await pending, false); await h.flush();
      assert.equal(h.value.enabled, true); assert.equal(h.value.locked, true); assert.equal(h.value.timeoutMs, 300_000); assert.equal(h.writes[0].key, biometricLockStorageKey("user-a"));
    } finally { h.close(); }
  });
  it("does not share native unlock results across users with the same native credential ID", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a"), "user-b": enrollment("user-b") }); try {
      await h.flush(); const auth = deferred<NativeResult>(); let count = 0; h.authenticateWith(() => ++count === 1 ? auth.promise : Promise.resolve({ success: false, error: "user_cancel" }));
      const oldUnlock = h.value.unlock(); await h.flush(); h.user("user-b"); await h.flush(); assert.equal(await h.value.unlock(), false); auth.resolve({ success: true }); assert.equal(await oldUnlock, false); await h.flush();
      assert.equal(h.value.enabled, true); assert.equal(h.value.locked, true); assert.equal(h.prompts.length, 2);
    } finally { h.close(); }
  });
  it("does not relock an Immediate enrollment because its setup prompt returns focus late", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a", { enabled: false, timeoutMs: 0 }) }); try {
      await h.flush(); const auth = deferred<NativeResult>(); h.authenticateWith(() => auth.promise);
      const pending = h.value.enable(); await h.flush(); h.state("background"); h.advance(5_000);
      auth.resolve({ success: true }); assert.equal(await pending, true); await h.flush();
      h.state("active"); await h.flush(); assert.equal(h.value.enabled, true); assert.equal(h.value.locked, false); assert.equal(h.prompts.length, 1);
      h.state("background"); h.state("active"); await h.flush(); assert.equal(h.value.locked, true);
    } finally { h.close(); }
  });
  it("an old delay callback cannot turn a successfully disabled lock back on before re-render", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }); try {
      await h.flush(); const oldDelaySetter = h.value.setAutoLockDelay;
      assert.equal(await h.value.disable(), true); assert.equal(await oldDelaySetter(0), false); await h.flush();
      assert.equal(h.value.enabled, false); assert.equal(h.writes.length, 1); assert.equal(JSON.parse(h.writes[0].value).enabled, false);
    } finally { h.close(); }
  });
  it("does not reuse a successful native unlock for a different signed-in user", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a"), "user-b": enrollment("user-b") }); try {
      await h.flush(); assert.equal(await h.value.unlock(), true); await h.flush();
      h.user("user-b"); await h.flush(); h.authenticateWith(async () => ({ success: false, error: "user_cancel" }));
      assert.equal(await h.value.unlock(), false); await h.flush(); assert.equal(h.prompts.length, 2); assert.equal(h.value.locked, true);
    } finally { h.close(); }
  });
  it("keeps a previous user's failed delay write from changing the current user's lock or error", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a"), "user-b": enrollment("user-b", { timeoutMs: 300_000 }) }); try {
      await h.flush(); const write = deferred<void>(); h.holdWrites(write.promise); const pending = h.value.setAutoLockDelay(0);
      await h.flush(); h.user("user-b"); await h.flush(); h.failWrites(true); write.resolve();
      assert.equal(await pending, false); await h.flush(); assert.equal(h.value.timeoutMs, 300_000); assert.equal(h.value.enabled, true); assert.equal(h.value.error, null); assert.equal(h.value.busy, false);
    } finally { h.close(); }
  });
  it("allows one setup prompt during rapid repeated enable taps", async () => {
    const h = providerHarness(); try {
      await h.flush(); const auth = deferred<NativeResult>(); h.authenticateWith(() => auth.promise);
      const first = h.value.enable(), second = h.value.enable(); await h.flush(); assert.equal(h.prompts.length, 1); assert.equal(await second, false);
      auth.resolve({ success: true }); assert.equal(await first, true); await h.flush(); assert.equal(h.writes.length, 1);
    } finally { h.close(); }
  });
  it("does not publish a delayed unlock after the provider unmounts", async () => {
    const h = providerHarness({ "user-a": enrollment("user-a") }); await h.flush();
    const auth = deferred<NativeResult>(); h.authenticateWith(() => auth.promise); const pending = h.value.unlock(); await h.flush();
    h.close(); auth.resolve({ success: true }); assert.equal(await pending, false);
  });

});

function lockScreenHarness(component: "BiometricLockGate" | "BiometricLockSettings", state: Record<string, unknown>) {
  const calls = { retry: 0, signOut: 0, enable: 0, disable: 0, unlock: 0 };
  const value = {
    locked: false, supported: false, enabled: false, busy: false, error: null, initializationError: null, timeoutMs: 120_000,
    retryLoad() { calls.retry++; }, signOut: async () => { calls.signOut++; },
    enable: async () => { calls.enable++; }, disable: async () => { calls.disable++; },
    unlock: async () => { calls.unlock++; return false; }, clearError() {}, lockNow() {}, setAutoLockDelay() {}, ...state,
  };
  const react = { useRef: (initial: unknown) => ({ current: initial }), useState: () => [false, () => {}], useEffect() {}, useLayoutEffect() {} };
  const output: any = {};
  const source = transpileModule(readFileSync(`components/${component}.tsx`, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("exports", "require", source)(output, (name: string) => {
    if (name === "react") return { __esModule: true, default: react, ...react };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
    if (name === "react-native") return { ActivityIndicator: "ActivityIndicator", Image: "Image", Modal: "Modal", Platform: { OS: "android" }, StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} } };
    if (name.endsWith("PrivacyPrimitives")) return { PrivacyPressable: "Pressable", PrivacyText: "Text", PrivacyView: "View" };
    if (name.endsWith("Feather")) return { __esModule: true, default: "Feather" };
    if (name.endsWith("AuthContext")) return { useAuth: () => ({ signOut: value.signOut }) };
    if (name.endsWith("BiometricLockContext")) return { useBiometricLock: () => value };
    if (name.endsWith("useColors")) return { useColors: () => new Proxy({}, { get: () => "#000000" }) };
    if (name.endsWith("biometricLock")) return lockHelpers;
    if (name.endsWith("appLockWebIsolation")) return { isolateAppLockWebPortals() {} };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name.endsWith(".png")) return "logo";
    throw new Error(`Unexpected lock screen dependency ${name}`);
  });
  const tree = output[component]({});
  const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
  return { tree, nodes: flatten(tree), calls };
}

it("lock settings errors show a protected retry and sign-out screen instead of an unlock action", async () => {
  const h = lockScreenHarness("BiometricLockGate", { locked: true, initializationError: "App Lock settings could not be checked. Try again or sign out." });
  assert.equal(h.tree.type, "Modal"); assert.equal(h.tree.props.visible, true);
  const retry = h.nodes.find(node => node.props.accessibilityLabel === "Try checking App Lock again");
  assert.ok(retry); retry.props.onPress();
  assert.equal(h.calls.retry, 1); assert.equal(h.calls.unlock, 0);
  const signOut = h.nodes.find(node => node.type === "Pressable" && node !== retry);
  await signOut.props.onPress(); assert.equal(h.calls.signOut, 1);
  assert.equal(lockScreenHarness("BiometricLockGate", { locked: false }).tree, null);
});

it("a recovered enabled lock can be explicitly switched off after a failed capability probe", async () => {
  const enabled = lockScreenHarness("BiometricLockSettings", { enabled: true, supported: false });
  const toggle = enabled.nodes.find(node => node.props.accessibilityRole === "switch");
  assert.equal(toggle.props.disabled, false); await toggle.props.onPress();
  assert.equal(enabled.calls.disable, 1); assert.equal(enabled.calls.enable, 0);
  const off = lockScreenHarness("BiometricLockSettings", { enabled: false, supported: false });
  assert.equal(off.nodes.find(node => node.props.accessibilityRole === "switch").props.disabled, true);
  assert.equal(off.calls.enable, 0);
});

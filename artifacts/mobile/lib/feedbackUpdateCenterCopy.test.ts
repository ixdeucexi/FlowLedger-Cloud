import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const SOURCE_ID = "123e4567-e89b-42d3-a456-426614174000";
const ADMIN_ID = "223e4567-e89b-42d3-a456-426614174000";
const UPDATE_CENTER_SCREEN = "Settings / Update Center";
const source = { id: SOURCE_ID, screen: "Dashboard / Bills", message: "Private saved feedback", user_id: "tester", user_email: "tester@example.test", user_name: "Tester", can_contact: true, admin_note: "Existing reply", archived_at: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function evaluate(path: string, imports: Record<string, unknown>) {
  const compiled = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function("exports", "require", compiled)(exports, (name: string) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  });
  return exports;
}

function harness() {
  const hooks: any[] = [];
  const effects: Array<() => void> = [];
  const requests: Array<{ path: string; init: any }> = [];
  const actions: unknown[] = [];
  const events: string[] = [];
  let cursor = 0, tree: any, opens = 0, closes = 0;
  let session: any = { access_token: "fictional-test-token", user: { id: ADMIN_ID } };
  let readSession: (() => Promise<any>) | null = null;
  let fetchReply: (() => Promise<any>) | null = null;
  let saved = { ok: true, copiedRequest: { id: "copied-request", archived_at: null as string | null, status: "new" }, alreadyExists: false };
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const React = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next: any) => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
    },
    useEffect: (setup: () => any, deps: unknown[]) => {
      const index = cursor++;
      if (!hooks[index] || !same(hooks[index].deps, deps)) {
        const previous = hooks[index];
        hooks[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = setup(); });
      }
    },
  };
  const api = evaluate("lib/feedbackApi.ts", {
    "@/lib/supabase": { supabase: { auth: { getSession: async () => { events.push("session"); return readSession ? readSession() : { data: { session } }; } } } },
    "@/lib/api": { apiFetch: async (path: string, init: any) => {
      events.push("request"); requests.push({ path, init });
      return fetchReply ? fetchReply() : { ok: true, json: async () => saved };
    } },
  });
  const modal = evaluate("components/FeedbackManageModal.tsx", {
    react: { __esModule: true, default: React, ...React },
    "react-native": { KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", ScrollView: "ScrollView", Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    "@/components/privacy/PrivacyPrimitives": { PrivacyPressable: "Pressable", PrivacyText: "Text", PrivacyTextInput: "TextInput", PrivacyView: "View" },
    "@expo/vector-icons/Feather": { __esModule: true, default: "Feather" },
    "@/components/ConfirmActionModal": { ConfirmActionOverlay: "ConfirmActionOverlay" },
    "@/hooks/useBackDismiss": { useBackDismiss: () => undefined },
    "@/hooks/useColors": { useColors: () => new Proxy({}, { get: () => "#555555" }) },
    "@/lib/feedbackApi": api,
    "@/lib/updateCenter": { UPDATE_CENTER_SCREEN },
  });
  const props: any = {
    feedback: { ...source }, busy: false,
    updateCenterCopyAccess: { scopeKey: "admin-a:household-a:budget-a:live:ready", userId: ADMIN_ID, allowed: true },
    onClose: () => { closes++; }, onAction: (...args: unknown[]) => actions.push(args), onOpenUpdateCenter: () => { opens++; },
  };
  const render = () => { cursor = 0; tree = modal.FeedbackManageModal(props); while (effects.length) effects.shift()!(); return tree; };
  const nodes = (root: any): any[] => Array.isArray(root) ? root.flatMap(nodes) : root && typeof root === "object" ? [root, ...nodes(root.props?.children)] : [];
  const button = (label: string) => nodes(tree).find(node => node.props?.accessibilityLabel === label);
  const text = () => nodes(tree).filter(node => node.type === "Text").flatMap(node => node.props.children.flat(Infinity)).filter(value => typeof value === "string").join(" ");
  const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); render(); };
  const unmount = () => { for (const hook of hooks) hook?.cleanup?.(); };
  return {
    api, props, requests, actions, events, render, button, text, settle, unmount,
    get opens() { return opens; }, get closes() { return closes; },
    setSession: (value: any) => { session = value; },
    deferSession: (reply: () => Promise<any>) => { readSession = reply; },
    deferFetch: (reply: () => Promise<any>) => { fetchReply = reply; },
    setSaved: (value: typeof saved) => { saved = value; },
  };
}

test("feedback modal mount performs no session lookup or request and hides copy for Update Center sources", async () => {
  const h = harness(); h.render(); await h.settle();
  assert.deepEqual(h.events, []);
  assert.ok(h.button("Add to Update Center"));
  assert.equal(h.button("Open Update Center"), undefined);
  h.props.feedback = { ...source, screen: UPDATE_CENTER_SCREEN }; h.render(); await h.settle();
  assert.equal(h.button("Add to Update Center"), undefined);
  assert.deepEqual(h.requests, []);
});

test("explicit copy sends only persisted source ID and action using the awaited account session", async () => {
  const h = harness(); h.render();
  const session = deferred<any>(); h.deferSession(() => session.promise);
  h.button("Add to Update Center").props.onPress();
  assert.deepEqual(h.events, ["session"]); assert.equal(h.requests.length, 0);
  session.resolve({ data: { session: { access_token: "fictional-resolved-token", user: { id: ADMIN_ID } } } });
  await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, "/api/feedback");
  assert.equal(h.requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { feedback_id: SOURCE_ID, action: "copyToUpdateCenter" });
  assert.deepEqual(h.requests[0].init.headers, { Authorization: "Bearer fictional-resolved-token", "Content-Type": "application/json" });
  assert.match(h.text(), /Added to Update Center\. The original feedback is unchanged\./);
  h.button("Open Update Center").props.onPress(); assert.equal(h.opens, 1);
  assert.deepEqual(h.actions, []);
});

test("synchronous duplicate copy clicks produce exactly one session lookup and request", async () => {
  const h = harness(); h.render();
  const reply = deferred<any>(); h.deferFetch(() => reply.promise);
  const add = h.button("Add to Update Center").props.onPress;
  add(); add(); await h.settle();
  assert.equal(h.events.filter(event => event === "session").length, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.button("Add to Update Center").props.disabled, true);
  reply.resolve({ ok: true, json: async () => ({ ok: true, copiedRequest: { id: "saved", archived_at: null, status: "new" }, alreadyExists: false }) });
  await h.settle(); assert.ok(h.button("Open Update Center"));
});

test("current access denial blocks even an invoked disabled copy callback", async () => {
  const h = harness(); h.props.updateCenterCopyAccess.allowed = false; h.render();
  const add = h.button("Add to Update Center"); assert.equal(add.props.disabled, true);
  add.props.onPress(); await h.settle(); assert.deepEqual(h.events, []);
});

test("captured callbacks cannot copy after household, user, or Demo scope changes", async () => {
  for (const change of ["household", "user", "demo"]) {
    const h = harness(); h.render(); const captured = h.button("Add to Update Center").props.onPress;
    h.props.updateCenterCopyAccess = { ...h.props.updateCenterCopyAccess, scopeKey: `changed-${change}`, ...(change === "user" ? { userId: "different-admin" } : {}), ...(change === "demo" ? { allowed: false } : {}) };
    h.render(); captured(); await h.settle(); assert.deepEqual(h.events, [], change);
  }
});

test("switching away and back never revives captured callbacks or authentication waits", async () => {
  for (const waiting of [false, true]) {
    const h = harness(); h.render(); const captured = h.button("Add to Update Center").props.onPress;
    const originalAccess = { ...h.props.updateCenterCopyAccess };
    const session = deferred<any>();
    if (waiting) { h.deferSession(() => session.promise); captured(); }
    h.props.updateCenterCopyAccess = { ...originalAccess, scopeKey: "different-budget" }; h.render();
    h.props.updateCenterCopyAccess = originalAccess; h.render();
    if (waiting) session.resolve({ data: { session: { access_token: "fictional-test-token", user: { id: ADMIN_ID } } } });
    else captured();
    await h.settle(); assert.deepEqual(h.requests, []);
    assert.equal(h.button("Open Update Center"), undefined);
    assert.equal(h.events.filter(event => event === "session").length, waiting ? 1 : 0);
  }
});

test("captured copy and saved Open callbacks cannot run after unmount", async () => {
  const h = harness(); h.render(); const capturedAdd = h.button("Add to Update Center").props.onPress;
  h.unmount(); capturedAdd(); await h.settle(); assert.deepEqual(h.events, []);
  const saved = harness(); saved.render(); saved.button("Add to Update Center").props.onPress(); await saved.settle();
  const capturedOpen = saved.button("Open Update Center").props.onPress;
  saved.unmount(); capturedOpen(); assert.equal(saved.opens, 0);
});

test("API rechecks resolved session identity, token, and live access immediately before request", async () => {
  for (const condition of ["identity", "token", "access"]) {
    const h = harness(); const session = deferred<any>(); h.deferSession(() => session.promise);
    let current = true;
    const result = h.api.copyFeedbackToUpdateCenter(SOURCE_ID, ADMIN_ID, () => current);
    const rejected = assert.rejects(result, /account changed/i);
    assert.equal(h.requests.length, 0);
    if (condition === "access") current = false;
    session.resolve({ data: { session: { access_token: condition === "token" ? "" : "fictional-test-token", user: { id: condition === "identity" ? "different-admin" : ADMIN_ID } } } });
    await rejected; assert.deepEqual(h.requests, [], condition);
  }
});

test("changing scope or access while awaiting authentication prevents a request", async () => {
  for (const change of ["scope", "demo", "unmount"]) {
    const h = harness(); h.render(); const session = deferred<any>(); h.deferSession(() => session.promise);
    h.button("Add to Update Center").props.onPress();
    if (change === "unmount") h.unmount();
    else { h.props.updateCenterCopyAccess = { ...h.props.updateCenterCopyAccess, ...(change === "scope" ? { scopeKey: "different-budget" } : { allowed: false }) }; h.render(); }
    session.resolve({ data: { session: { access_token: "fictional-test-token", user: { id: ADMIN_ID } } } });
    await h.settle(); assert.deepEqual(h.requests, [], change); assert.equal(h.button("Open Update Center"), undefined);
  }
});

test("deferred responses never expose a saved affordance after scope change or unmount", async () => {
  for (const change of ["scope", "demo", "unmount"]) {
    const h = harness(); h.render(); const reply = deferred<any>(); h.deferFetch(() => reply.promise);
    h.button("Add to Update Center").props.onPress(); await h.settle(); assert.equal(h.requests.length, 1);
    if (change === "unmount") h.unmount();
    else { h.props.updateCenterCopyAccess = { ...h.props.updateCenterCopyAccess, scopeKey: "changed-scope", ...(change === "demo" ? { allowed: false } : {}) }; h.render(); }
    reply.resolve({ ok: true, json: async () => ({ ok: true, copiedRequest: { id: "saved", archived_at: null, status: "new" }, alreadyExists: false }) });
    await h.settle(); assert.equal(h.button("Open Update Center"), undefined, change); assert.doesNotMatch(h.text(), /Added to Update Center\./);
  }
});

test("a stale response after switching away and back cannot unlock or replace the newer copy", async () => {
  const h = harness(); h.render(); const originalAccess = { ...h.props.updateCenterCopyAccess };
  const oldReply = deferred<any>(), currentReply = deferred<any>();
  let attempts = 0;
  h.deferFetch(() => ++attempts === 1 ? oldReply.promise : currentReply.promise);
  h.button("Add to Update Center").props.onPress(); await h.settle();
  h.props.updateCenterCopyAccess = { ...originalAccess, scopeKey: "different-budget" }; h.render();
  h.props.updateCenterCopyAccess = originalAccess; h.render();
  const currentAdd = h.button("Add to Update Center").props.onPress; currentAdd(); await h.settle();
  assert.equal(h.requests.length, 2);
  oldReply.resolve({ ok: true, json: async () => ({ ok: true, copiedRequest: { id: "stale", archived_at: null, status: "new" }, alreadyExists: false }) });
  await h.settle(); assert.equal(h.button("Open Update Center"), undefined);
  currentAdd(); await h.settle(); assert.equal(h.requests.length, 2);
  assert.equal(h.button("Add to Update Center").props.disabled, true);
  currentReply.resolve({ ok: true, json: async () => ({ ok: true, copiedRequest: { id: "current", archived_at: null, status: "new" }, alreadyExists: false }) });
  await h.settle(); assert.ok(h.button("Open Update Center"));
});

test("failed copy displays its error and permits an explicit retry", async () => {
  const h = harness(); h.render();
  let attempts = 0;
  h.deferFetch(async () => ++attempts === 1 ? { ok: false, json: async () => ({ message: "Save temporarily unavailable" }) } : { ok: true, json: async () => ({ ok: true, copiedRequest: { id: "saved", archived_at: null, status: "new" }, alreadyExists: false }) });
  h.button("Add to Update Center").props.onPress(); await h.settle();
  assert.match(h.text(), /Save temporarily unavailable/); assert.equal(h.button("Open Update Center"), undefined);
  assert.equal(h.button("Add to Update Center").props.disabled, false);
  h.button("Add to Update Center").props.onPress(); await h.settle();
  assert.equal(h.requests.length, 2); assert.ok(h.button("Open Update Center"));
});

test("existing archived pending copies explain Restore while completed copies remain history", async () => {
  for (const status of ["new", "reviewing", "fixed", "wont_fix"]) {
    const h = harness(); h.setSaved({ ok: true, copiedRequest: { id: "existing", archived_at: "2026-11-01T00:00:00.000Z", status }, alreadyExists: true });
    h.render(); h.button("Add to Update Center").props.onPress(); await h.settle();
    assert.ok(h.button("Open Update Center"));
    if (["new", "reviewing"].includes(status)) assert.match(h.text(), /Restore the archived request there if needed/);
    else { assert.match(h.text(), /Already completed in Update Center\. Open it to view the history\./); assert.doesNotMatch(h.text(), /Restore the archived request/); }
    assert.equal(h.requests.length, 1); assert.deepEqual(h.actions, []);
  }
});

test("saved Open callback is blocked when its scope or live permission changes", async () => {
  for (const scopeChanged of [false, true]) {
    const h = harness(); h.render(); h.button("Add to Update Center").props.onPress(); await h.settle();
    const open = h.button("Open Update Center").props.onPress;
    h.props.updateCenterCopyAccess = { ...h.props.updateCenterCopyAccess, ...(scopeChanged ? { scopeKey: "different-budget" } : { allowed: false }) };
    h.render(); open(); assert.equal(h.opens, 0);
  }
});

test("retained saved Open callback cannot navigate during a later copy retry", async () => {
  const h = harness(); h.render(); h.button("Add to Update Center").props.onPress(); await h.settle();
  const capturedOpen = h.button("Open Update Center").props.onPress;
  const retry = deferred<any>(); h.deferFetch(() => retry.promise);
  h.button("Add to Update Center").props.onPress(); capturedOpen();
  assert.equal(h.opens, 0);
  await h.settle(); capturedOpen(); assert.equal(h.opens, 0);
  retry.resolve({ ok: true, json: async () => ({ ok: true, copiedRequest: { id: "saved", archived_at: null, status: "new" }, alreadyExists: true }) });
  await h.settle(); h.button("Open Update Center").props.onPress(); assert.equal(h.opens, 1);
});

test("More copy access combines both Demo sources and global admin readiness without household-role gating", () => {
  const more = readFileSync("app/(tabs)/more.tsx", "utf8");
  assert.match(more, /const demoMode = Boolean\(authDemoMode \|\| budgetDemoMode\)/);
  const access = more.match(/updateCenterCopyAccess=\{\{([\s\S]*?)\}\}/)?.[1];
  assert.ok(access);
  assert.match(more, /const feedbackCopyScopeKey = JSON\.stringify\(\[user\?\.id, activeHousehold\?\.householdId, activeHousehold\?\.budgetId, demoMode, feedbackAdmin, membershipLoading, membershipAccessReady\]\)/);
  assert.match(access, /scopeKey: feedbackCopyScopeKey/);
  assert.match(access, /userId: user\?\.id \?\? null/);
  assert.match(access, /allowed: Boolean\(user\?\.id && feedbackAdmin && membershipAccessReady && !membershipLoading && !demoMode\)/);
  assert.doesNotMatch(access, /canEditHousehold|householdRole|viewer|editor/);
  assert.match(more, /onOpenUpdateCenter=\{\(\) => \{\s*setManagedFeedback\(null\);\s*openSettingsSection\("updates"\);/);
});

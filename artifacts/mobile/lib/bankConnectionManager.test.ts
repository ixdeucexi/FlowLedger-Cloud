import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";
import * as management from "./bankConnectionManagement";

const status = {
  items: [{ id: "bank", institution_name: "Example Bank", status: "active", can_disconnect: true, initial_import_version: 1, history_status: "complete" }],
  accounts: [{ id: "checking", plaid_item_record_id: "bank", display_name: "Home checking", mask: "1234", is_active: true }, { id: "card", plaid_item_record_id: "bank", name: "Travel card", mask: "5678", is_active: true }],
};

function harness({ demo = false, budgetDemo = false, editor = true, permitted = true } = {}) {
  const hooks: any[] = [];
  let cursor = 0;
  const effects: Array<() => void> = [];
  const requests: Array<{ path: string; init: any }> = [];
  const refreshes: unknown[] = [];
  const confirmations: any[] = [];
  const auth = { user: { id: "user-a" }, session: { access_token: "fictional-test-token" }, demoMode: demo };
  const budget = { activeHousehold: { householdId: "household-a", budgetId: "budget-a" }, canEditHousehold: editor, demoMode: budgetDemo, householdTimeZone: "UTC", refreshBankData: async (options: unknown) => { refreshes.push(options); } };
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, index) => Object.is(v, b[index]));
  const React = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useRef: (value: unknown) => { const index = cursor++; return hooks[index] ??= { current: value }; },
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next: any) => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const index = cursor++;
      if (!hooks[index] || !same(hooks[index].deps, deps)) hooks[index] = { value: fn, deps };
      return hooks[index].value;
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
  let postReply: (() => Promise<any>) | null = null;
  const request = async (path: string, init: any) => {
    requests.push({ path, init });
    if (init.method === "POST") return postReply ? postReply() : { ok: true, json: async () => ({ ok: true, status: "disconnected" }) };
    const payload = { ...status, items: status.items.map(item => ({ ...item, can_disconnect: permitted })) };
    return { ok: true, json: async () => payload };
  };
  const compiled = transpileModule(readFileSync("components/BankConnectionManager.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function("exports", "require", compiled)(exports, (name: string) => {
    if (name === "react") return { __esModule: true, default: React, ...React };
    if (name === "react-native") return { ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (value: unknown) => value } };
    if (name.endsWith("PrivacyPrimitives")) return { PrivacyText: "Text", PrivacyView: "View", PrivacyPressable: "Pressable" };
    if (name.endsWith("AuthContext")) return { useAuth: () => auth };
    if (name.endsWith("BudgetContext")) return { useBudget: () => budget };
    if (name.endsWith("useColors")) return { useColors: () => new Proxy({}, { get: () => "#555555" }) };
    if (name.endsWith("bankConnectionManagement")) return management;
    if (name.endsWith("api")) return { apiFetch: request };
    if (name.endsWith("confirmAction")) return { confirmAction: (options: any) => confirmations.push(options) };
    if (name.endsWith("plaidOAuth")) return { PLAID_CONNECTION_RESULT_EVENT: "fictional-result-event" };
    throw new Error("Unexpected component dependency " + name);
  });
  let tree: any;
  const render = () => { cursor = 0; tree = exports.BankConnectionManager({ ready: true }); while (effects.length) effects.shift()!(); return tree; };
  const nodes = (root: any): any[] => Array.isArray(root) ? root.flatMap(nodes) : root && typeof root === "object" ? [root, ...nodes(root.props?.children)] : [];
  const button = (label: string) => nodes(tree).find(node => node.props?.accessibilityLabel === label);
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); };
  return { auth, budget, requests, refreshes, confirmations, render, button, settle, deferPost: (reply: () => Promise<any>) => { postReply = reply; } };
}

test("manager mount only reads status and unlink waits for explicit whole-bank confirmation", async () => {
  const h = harness();h.render();await h.settle();
  assert.deepEqual(h.requests.map(request => [request.path, request.init.method]), [["/api/plaid/status", "GET"]]);
  h.button("Unlink Example Bank").props.onPress();
  assert.equal(h.requests.length, 1);
  assert.match(h.confirmations[0].message, /Home checking · •••• 1234/);
  assert.match(h.confirmations[0].message, /Travel card · •••• 5678/);
  assert.equal(h.confirmations[0].confirmText, "Unlink bank");
  assert.equal(h.confirmations[0].cancelText, "Keep connected");
  await h.confirmations[0].onConfirm();
  assert.deepEqual(JSON.parse(h.requests[1]!.init.body), { household_id: "household-a", item_id: "bank" });
  assert.equal(h.requests[1]!.init.headers["X-FlowLedger-Household-Id"], "household-a");
  assert.deepEqual(h.refreshes, [{ savedOnly: true }]);
  assert.equal(h.requests.some(request => request.path.includes("sync")), false);
});

test("Demo and view-only modes cannot load management status or unlink", async () => {
  for (const options of [{ demo: true }, { budgetDemo: true }, { editor: false }]) {
    const h = harness(options);h.render();await h.settle();
    assert.deepEqual(h.requests, []);
    assert.equal(h.button("Unlink Example Bank"), undefined);
    assert.equal(h.button("Reload bank connection details").props.disabled, true);
  }
});

test("server capability must explicitly allow unlink even for a household editor", async () => {
  const h = harness({ permitted: false });h.render();await h.settle();
  const unlink = h.button("Unlink Example Bank");assert.equal(unlink.props.disabled, true);unlink.props.onPress();
  assert.deepEqual(h.confirmations, []);
});

test("old confirmation cannot unlink after household switch or entering Demo", async () => {
  for (const demo of [false, true]) {
    const h = harness();h.render();await h.settle();const oldButton = h.button("Unlink Example Bank");oldButton.props.onPress();
    if (demo) h.auth.demoMode = true;
    else h.budget.activeHousehold = { householdId: "household-b", budgetId: "budget-b" };
    h.render();await h.settle();oldButton.props.onPress();assert.equal(h.confirmations.length, 1);await h.confirmations[0].onConfirm();
    assert.equal(h.requests.some(request => request.init.method === "POST"), false);
    assert.deepEqual(h.refreshes, []);
  }
});

test("duplicate confirmation cannot send a second unlink while the first is pending", async () => {
  const h = harness();h.render();await h.settle();h.button("Unlink Example Bank").props.onPress();
  let resolve!: (reply: any) => void;
  h.deferPost(() => new Promise(reply => { resolve = reply; }));
  const first = h.confirmations[0].onConfirm();await Promise.resolve();await h.confirmations[0].onConfirm();
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1);
  resolve({ ok: true, json: async () => ({ ok: true, status: "disconnected" }) });await first;
  assert.deepEqual(h.refreshes, [{ savedOnly: true }]);
});

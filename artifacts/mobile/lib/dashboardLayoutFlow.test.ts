import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as layouts from "./dashboardCustomization";
import * as persistence from "./dashboardLayoutPersistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const key = (user: string, household: string) => JSON.stringify([user, household]);
const savedLayout = (hidden: layouts.DashboardWidgetId[] = ["accounts", "setup"]) => layouts.normalizeDashboardLayout({
  ...layouts.DEFAULT_DASHBOARD_LAYOUT, hidden, accountsCollapsed: true,
});
function sourceModule(path: string, dependencies: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", source)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected source dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

/** Run the real hook and controller with fictional, scope-keyed storage and RPCs. */
function hookHarness() {
  const state = {
    user: { id: "actor-a" } as { id: string } | null,
    household: { householdId: "home-a", budgetId: "budget-a" } as { householdId: string; budgetId: string } | null,
    demoMode: false,
    locals: new Map<string, Record<string, unknown>>(),
    remotes: new Map<string, Record<string, unknown>>(),
    remoteGate: null as Promise<void> | null,
    remoteError: false,
    localWrites: [] as Array<{ scope: string; value: Record<string, unknown> }>,
    remoteWrites: [] as Array<{ user: string; household: string; layout: layouts.DashboardLayoutPreference; authorization: string }>,
    remoteReads: [] as string[],
  };
  const hooks: any[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0, dirty = false;
  const changed = (a?: any[], b?: any[]) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const useState = (initial: any) => {
    const slot = cursor++;
    if (!(slot in hooks)) hooks[slot] = { value: typeof initial === "function" ? initial() : initial };
    return [hooks[slot].value, (next: any) => {
      const value = typeof next === "function" ? next(hooks[slot].value) : next;
      if (!Object.is(value, hooks[slot].value)) { hooks[slot].value = value; dirty = true; }
    }];
  };
  const useRef = (initial: any) => { const slot = cursor++; return hooks[slot] ?? (hooks[slot] = { current: initial }); };
  const useCallback = (callback: any, deps: any[]) => {
    const slot = cursor++;
    if (!(slot in hooks) || changed(hooks[slot].deps, deps)) hooks[slot] = { value: callback, deps };
    return hooks[slot].value;
  };
  const useEffect = (effect: () => any, deps: any[]) => {
    const slot = cursor++;
    if (!(slot in hooks) || changed(hooks[slot].deps, deps)) {
      const previous = hooks[slot]?.cleanup;
      hooks[slot] = { deps };
      effects.push(() => { previous?.(); hooks[slot].cleanup = effect(); });
    }
  };
  const mod = sourceModule("hooks/useDashboardLayoutPreferences.ts", {
    react: { useState, useRef, useCallback, useEffect },
    "@/context/AuthContext": { useAuth: () => ({ user: state.user, demoMode: state.demoMode }) },
    "@/context/BudgetContext": { useBudget: () => ({ activeHousehold: state.household }) },
    "@/lib/dashboardCustomization": layouts,
    "@/lib/dashboardLayoutPersistence": persistence,
    "@/lib/interfacePreferences": {
      readInterfacePreferences: async (user: string, household: string) => state.locals.get(key(user, household)) ?? {},
      updateInterfacePreferences: async (user: string, household: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => {
        const scope = key(user, household), value = update(state.locals.get(scope) ?? {});
        state.locals.set(scope, value); state.localWrites.push({ scope, value });
        return value;
      },
    },
    "@/lib/supabase": { supabase: {
      from: () => {
        let user = "";
        const query: any = {
          select: () => query,
          eq: (_column: string, value: string) => { user = value; return query; },
          maybeSingle: async () => {
            state.remoteReads.push(user);
            const gate = state.remoteGate;
            if (gate) await gate;
            return { data: state.remotes.has(user) ? { dashboard_layouts: state.remotes.get(user) } : null, error: state.remoteError ? new Error("fixture offline") : null };
          },
        };
        return query;
      },
      auth: { getSession: async () => ({ data: { session: state.user ? { user: state.user, access_token: `fixture-${state.user.id}` } : null }, error: null }) },
      rpc: (_name: string, args: { p_household_id: string; p_layout: layouts.DashboardLayoutPreference }) => ({
        setHeader: async (_name: string, authorization: string) => {
          state.remoteWrites.push({ user: state.user!.id, household: args.p_household_id, layout: args.p_layout, authorization });
          return { error: null };
        },
      }),
    } },
  });
  let current: persistence.DashboardLayoutState & {
    updateLayout: (next: layouts.DashboardLayoutPreference | ((layout: layouts.DashboardLayoutPreference) => layouts.DashboardLayoutPreference)) => void;
    resetLayout: () => void;
    retrySave: () => void;
    retryLoad: () => void;
  };
  const render = () => {
    for (let attempts = 0; attempts < 10; attempts++) {
      cursor = 0; dirty = false;
      current = mod.useDashboardLayoutPreferences();
      while (effects.length) effects.shift()!();
      if (!dirty) return current;
    }
    throw new Error("Dashboard layout hook did not settle");
  };
  const flush = async () => { await tick(); return render(); };
  return { state, render, flush, get current() { return current; } };
}

function sectionsHarness() {
  const mod = sourceModule("components/DashboardSections.tsx", {
    react: React,
    "react-native": { View: "View", StyleSheet: { create: (styles: unknown) => styles } },
    "@/components/privacy/PrivacyPrimitives": { PrivacyPressable: "Pressable" },
    "@/components/AppText": { AppText: "Text" },
    "@/hooks/useColors": { useColors: () => ({ card: "#111", border: "#222", foreground: "#fff", mutedForeground: "#aaa", primary: "#a855f7", primaryForeground: "#fff" }) },
    "@/lib/dashboardCustomization": layouts,
  });
  type Node = { type: string; props: any; children: Array<Node | string> };
  const expand = (node: any): Array<Node | string> => {
    if (node == null || typeof node === "boolean") return [];
    if (Array.isArray(node)) return node.flatMap(expand);
    if (typeof node === "string" || typeof node === "number") return [String(node)];
    if (typeof node.type === "function") return expand(node.type(node.props));
    return [{ type: String(node.type), props: node.props ?? {}, children: expand(node.props?.children) }];
  };
  return (props: Record<string, unknown>) => expand(mod.DashboardSections(props));
}

test("the real preference hook cannot save defaults before an unknown read or after a failed read", async () => {
  const h = hookHarness(), remote = deferred<void>();
  h.state.remoteGate = remote.promise;
  let current = h.render();
  assert.equal(current.ready, false);
  current.updateLayout(layouts.DEFAULT_DASHBOARD_LAYOUT); current.resetLayout();
  current = await h.flush();
  assert.equal(current.ready, false);
  assert.equal(h.state.localWrites.length, 0);
  assert.equal(h.state.remoteWrites.length, 0);
  h.state.remoteError = true; remote.resolve();
  current = await h.flush();
  assert.equal(current.ready, false);
  assert.ok(current.loadError);
  current.updateLayout(layouts.DEFAULT_DASHBOARD_LAYOUT); current.resetLayout();
  await h.flush();
  assert.equal(h.state.localWrites.length, 0);
  assert.equal(h.state.remoteWrites.length, 0);
  const saved = savedLayout();
  h.state.remoteError = false; h.state.remoteGate = null;
  h.state.remotes.set("actor-a", { "home-a": saved });
  current.retryLoad();
  current = await h.flush();
  assert.equal(current.ready, true);
  assert.deepEqual(current.layout, saved);
});

test("the real hook resets scope snapshots immediately and rejects all old A callbacks after A-B-A", async () => {
  const h = hookHarness(), saved = savedLayout();
  h.state.locals.set(key("actor-a", "home-a"), { dashboard: saved });
  h.state.remotes.set("actor-a", { "home-a": saved });
  h.render(); const oldA = await h.flush();
  assert.equal(oldA.ready, true);
  h.state.household = { householdId: "home-b", budgetId: "budget-b" };
  assert.equal(h.render().ready, false, "the first new-scope render cannot reuse a prior saved snapshot");
  const newB = await h.flush();
  assert.equal(newB.ready, true);
  assert.deepEqual(newB.layout, layouts.DEFAULT_DASHBOARD_LAYOUT);
  h.state.household = { householdId: "home-a", budgetId: "budget-a" };
  assert.equal(h.render().ready, false, "returning to A still begins a new scope generation");
  let newA = await h.flush();
  assert.deepEqual(newA.layout, saved);
  const before = { local: h.state.localWrites.length, remote: h.state.remoteWrites.length, reads: h.state.remoteReads.length };
  oldA.updateLayout(layouts.DEFAULT_DASHBOARD_LAYOUT); oldA.resetLayout(); oldA.retrySave(); oldA.retryLoad();
  newA = await h.flush();
  assert.deepEqual({ local: h.state.localWrites.length, remote: h.state.remoteWrites.length, reads: h.state.remoteReads.length }, before);
  assert.deepEqual(newA.layout, saved);
  newA.updateLayout(current => layouts.setDashboardAccountsCollapsed(current, false));
  newA.updateLayout(current => layouts.setDashboardWidgetVisible(current, "breathing_room", false));
  newA = await h.flush();
  assert.equal(newA.layout.accountsCollapsed, false);
  assert.ok(newA.layout.hidden.includes("accounts"));
  assert.ok(newA.layout.hidden.includes("breathing_room"));
  assert.equal(h.state.remoteWrites.length, before.remote + 1);
  assert.deepEqual(h.state.remoteWrites.at(-1)?.layout, newA.layout);
  assert.equal(h.state.remoteWrites.at(-1)?.authorization, "Bearer fixture-actor-a");
});

test("a delayed old actor read cannot replace the next actor's cached preferences", async () => {
  const h = hookHarness(), remote = deferred<void>(), savedB = savedLayout(["overview", "zero_based_budget"]);
  h.state.remoteGate = remote.promise;
  h.render(); await h.flush();
  h.state.user = { id: "actor-b" };
  h.state.locals.set(key("actor-b", "home-a"), { dashboard: savedB });
  h.state.remotes.set("actor-b", { "home-a": savedB });
  assert.equal(h.render().ready, false);
  let current = await h.flush();
  assert.equal(current.ready, true, "the new actor's own cache can render before its cloud read finishes");
  assert.equal(current.loading, true);
  assert.deepEqual(current.layout, savedB);
  h.state.remotes.set("actor-a", { "home-a": layouts.DEFAULT_DASHBOARD_LAYOUT });
  remote.resolve();
  current = await h.flush();
  assert.equal(current.ready, true);
  assert.deepEqual(current.layout, savedB);
  assert.ok(h.state.localWrites.every(write => write.scope === key("actor-b", "home-a")));
});

test("real DashboardSections mounts no financial body before readiness and keeps an all-hidden layout recoverable", () => {
  const render = sectionsHarness();
  let mounts = 0, chosen = 0, resets = 0;
  const financialBody = () => { mounts += 1; return React.createElement("Text", null, "Fictional balance $1,234.56"); };
  const props = {
    layout: layouts.DEFAULT_DASHBOARD_LAYOUT,
    sections: { overview: React.createElement(financialBody), accounts: React.createElement(financialBody) },
    ready: false, onCustomize: () => { chosen += 1; }, onReset: () => { resets += 1; },
  };
  assert.deepEqual(render(props), []);
  assert.equal(mounts, 0);
  const allHidden = { ...layouts.DEFAULT_DASHBOARD_LAYOUT, hidden: [...layouts.DASHBOARD_WIDGET_IDS], accountsCollapsed: true };
  const empty = render({ ...props, layout: allHidden, ready: true });
  const flatten = (nodes: any[]): any[] => nodes.flatMap(node => typeof node === "string" ? [] : [node, ...flatten(node.children)]);
  const nodes = flatten(empty), text = JSON.stringify(empty);
  assert.match(text, /Your Dashboard is empty/);
  assert.doesNotMatch(text, /Fictional balance/);
  assert.equal(mounts, 0);
  nodes.find(node => node.type === "Pressable" && JSON.stringify(node.children).includes("Choose cards"))?.props.onPress();
  nodes.find(node => node.type === "Pressable" && JSON.stringify(node.children).includes("Restore default layout"))?.props.onPress();
  assert.equal(chosen, 1); assert.equal(resets, 1);
  const visible = render({ ...props, ready: true, layout: { ...allHidden, hidden: allHidden.hidden.filter(id => id !== "accounts") } });
  assert.match(JSON.stringify(visible), /Dashboard section: Accounts/);
  assert.equal(mounts, 1);
});

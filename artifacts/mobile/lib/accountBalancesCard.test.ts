import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";
import type { ForecastAccountDescriptor } from "./accountForecasts";
import { privateTextChildren } from "./moneyPrivacyChildren";
import { moneyPrivacyAccessibility } from "./moneyPrivacy";
import * as dates from "./dateLabels";

const bankRef = (n: number) => `bank:00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as const;
function account(n: number, patch: Partial<ForecastAccountDescriptor> = {}): ForecastAccountDescriptor {
  return {
    ref: bankRef(n), name: `Saved account ${n}`, type: n === 1 ? "checking" : "savings", source: "bank",
    mask: String(1000 + n), currentBalance: n * 1000, availableBalance: n * 1000,
    asOfDate: "2026-11-11", observedAt: "2026-11-11T15:00:00Z", active: true,
    aliases: [bankRef(n)], savingsApy: null, safetyFloor: null, ...patch,
  };
}

type Tree = { type: string; props: any; children: Array<Tree | string> };
/** Execute the actual component. Native primitives are inert; their privacy
 * transformations are the same pure functions used by the real wrappers. */
function harness(rows = [account(1), account(2), account(3)], options: { hidden?: boolean; width?: number } = {}) {
  const state = {
    hidden: options.hidden ?? false,
    user: { id: "actor-a" } as { id: string } | null,
    actions: [] as unknown[][],
    budget: {
      forecastAccounts: rows,
      accountForecastReady: true, accountForecastError: null as string | null,
      forecastVisibilityReady: true, forecastVisibilityError: null as string | null,
      hiddenForecastAccountRefs: [] as string[], startupCoreReady: true, loading: false, loadError: null as string | null,
      activeHousehold: { householdId: "home-a", budgetId: "budget-a" }, demoMode: false,
      householdTimeZone: "America/Chicago",
      setSelectedForecastAccountRef: (ref: unknown) => state.actions.push(["select", ref]),
    },
  };
  const hooks: any[] = [];
  let cursor = 0, dirty = false;
  const effects: Array<() => void> = [];
  const changed = (a: any[] | undefined, b: any[] | undefined) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const useState = (initial: any) => {
    const slot = cursor++;
    if (!(slot in hooks)) hooks[slot] = { value: typeof initial === "function" ? initial() : initial };
    return [hooks[slot].value, (next: any) => {
      const value = typeof next === "function" ? next(hooks[slot].value) : next;
      if (!Object.is(value, hooks[slot].value)) { hooks[slot].value = value; dirty = true; }
    }];
  };
  const useRef = (initial: any) => { const slot = cursor++; return hooks[slot] ?? (hooks[slot] = { current: initial }); };
  const useMemo = (fn: () => any, deps?: any[]) => {
    const slot = cursor++;
    if (!(slot in hooks) || changed(hooks[slot].deps, deps)) hooks[slot] = { value: fn(), deps };
    return hooks[slot].value;
  };
  const useEffect = (fn: () => any, deps?: any[]) => {
    const slot = cursor++;
    if (!(slot in hooks) || changed(hooks[slot].deps, deps)) {
      const previous = hooks[slot]?.cleanup;
      hooks[slot] = { deps };
      effects.push(() => { previous?.(); hooks[slot].cleanup = fn(); });
    }
  };
  const react = { ...React, useState, useRef, useMemo, useCallback: (fn: any, deps: any[]) => useMemo(() => fn, deps), useEffect, useLayoutEffect: useEffect };
  const privatePrimitive = (type: string) => ({ sensitive = false, children, ...props }: any) => React.createElement(type,
    moneyPrivacyAccessibility(props, state.hidden, sensitive),
    type === "Text" ? privateTextChildren(children, state.hidden, sensitive) : children);
  const deps: Record<string, unknown> = {
    react,
    "react-native": { StyleSheet: { create: (s: any) => s, hairlineWidth: 1, flatten: (s: any) => Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s }, Platform: { OS: "web" }, useWindowDimensions: () => ({ width: options.width ?? 390, height: 1000 }), View: "View", Text: "Text", Pressable: "Pressable" },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => state.actions.push(["push", route]) }) },
    "@expo/vector-icons/Feather": (props: any) => React.createElement("Icon", props),
    "@/context/BudgetContext": { useBudget: () => state.budget },
    "@/context/AuthContext": { useAuth: () => ({ user: state.user }) },
    "@/hooks/useColors": { useColors: () => ({ primary: "#a855f7", foreground: "#ffffff", mutedForeground: "#94a3b8", card: "#0f172a", border: "#334155", background: "#030712", success: "#22c55e", warning: "#fbbf24", destructive: "#f43f5e", mode: "dark", radius: { md: 14 } }) },
    "@/components/AppText": { AppText: privatePrimitive("Text") },
    "@/components/privacy/PrivacyPrimitives": { PrivacyPressable: privatePrimitive("Pressable"), PrivacyView: privatePrimitive("View"), PrivacyText: privatePrimitive("Text") },
    "@/lib/dateLabels": dates,
  };
  const code = ts.transpileModule(readFileSync("components/AccountBalancesCard.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected component dependency: ${name}`);
    return deps[name];
  }, mod, mod.exports);
  const expand = (node: any): Array<Tree | string> => {
    if (node == null || typeof node === "boolean") return [];
    if (Array.isArray(node)) return node.flatMap(expand);
    if (typeof node === "string" || typeof node === "number") return [String(node)];
    if (typeof node.type === "function") return expand(node.type(node.props));
    return [{ type: typeof node.type === "string" ? node.type : "Fragment", props: node.props ?? {}, children: expand(node.props?.children) }];
  };
  let tree: Array<Tree | string> = [];
  const render = () => {
    for (let attempts = 0; attempts < 8; attempts++) {
      cursor = 0; dirty = false;
      tree = expand(mod.exports.AccountBalancesCard());
      while (effects.length) effects.shift()!();
      if (!dirty) return tree;
    }
    throw new Error("Component did not settle after effects");
  };
  const nodes = (): Tree[] => {
    const visit = (items: Array<Tree | string>): Tree[] => items.flatMap(item => typeof item === "string" ? [] : [item, ...visit(item.children)]);
    return visit(tree);
  };
  const text = () => {
    const visit = (items: Array<Tree | string>): string => items.map(item => typeof item === "string" ? item : visit(item.children)).join(" ");
    return visit(tree).replace(/\s+/g, " ").trim();
  };
  const forecast = (name: string) => nodes().find(node => /^View forecast for /i.test(node.props.accessibilityLabel ?? "") && (node.props.accessibilityLabel ?? "").includes(name));
  render();
  return { state, render, nodes, text, forecast };
}

test("Dashboard balances show saved current observations and a distinct available amount", () => {
  const h = harness([account(1, { name: "Household Bills", currentBalance: 1000, availableBalance: 950 }), account(2), account(3)]);
  assert.match(h.text(), /Household Bills/);
  assert.match(h.text(), /1,000\.00/);
  assert.match(h.text(), /950\.00/);
  assert.match(h.text(), /Current balance/i);
  assert.match(h.text(), /Available/i);
  assert.match(h.text(), /Nov 11|2026-11-11/);
  assert.match(h.text(), /Bank balances as of Nov 11, 2026/);
  assert.equal((h.text().match(/Nov 11, 2026/g) ?? []).length, 1, "equal bank dates have one clearly scoped visible summary");
  assert.equal(h.nodes().filter(node => node.props.accessibilityRole === "button" && /View forecast for/.test(node.props.accessibilityLabel ?? "")).length, 3);
  assert.equal(h.nodes().filter(node => /View forecast for/.test(node.props.accessibilityLabel ?? "") && /As of Nov 11, 2026/.test(node.props.accessibilityLabel ?? "")).length, 3, "each account's accessible label retains its observation date");
  const different = harness([account(1), account(2, { asOfDate: "2026-11-10" })]);
  assert.doesNotMatch(different.text(), /Bank balances as of/);
  assert.match(different.text(), /As of Nov 11, 2026/); assert.match(different.text(), /As of Nov 10, 2026/);
  const missing = harness([account(1), account(2, { asOfDate: null })]);
  assert.doesNotMatch(missing.text(), /Bank balances as of/);
  assert.match(missing.text(), /As of Nov 11, 2026/); assert.match(missing.text(), /Balance date unavailable/);
});

test("zero and negative current amounts remain exact while missing observations stay unavailable", () => {
  const h = harness([account(1, { currentBalance: 0, availableBalance: 0 }), account(2, { currentBalance: -15.25, availableBalance: null }), account(3, { currentBalance: null, availableBalance: null, unavailableReason: "Balance unavailable" })]);
  assert.match(h.text(), /\$0\.00/);
  assert.match(h.text(), /[−-]\$15\.25/);
  assert.match(h.text(), /Balance unavailable/);
  assert.equal((h.text().match(/\$0\.00/g) ?? []).length, 1);
  assert.equal((h.text().match(/Available/g) ?? []).length, 0, "same or absent available values must not add another amount");
});

test("manual accounts remain discoverable separately and expansion cannot survive a household change", () => {
  const manual = account(4, { ref: "manual:cash", source: "manual", name: "Manual holiday", aliases: ["manual:cash"], asOfDate: "2026-11-09" });
  const h = harness([account(1), manual, account(9, { active: false, name: "Closed account" })]);
  assert.doesNotMatch(h.text(), /Manual holiday|Closed account/);
  const toggle = h.nodes().find(node => /Manual accounts/i.test(node.props.accessibilityLabel ?? ""));
  assert.equal(toggle?.props["aria-expanded"], false);
  assert.equal(toggle?.props.accessibilityState?.expanded, false);
  assert.ok(toggle?.props.onPress); toggle.props.onPress(); h.render();
  assert.match(h.text(), /Manual holiday/);
  assert.match(h.text(), /Bank balances as of Nov 11, 2026/);
  assert.match(h.text(), /As of Nov 9, 2026/, "a shared bank date never replaces the manual account's own date");
  const expandedToggle = h.nodes().find(node => /Manual accounts/i.test(node.props.accessibilityLabel ?? ""));
  assert.equal(expandedToggle?.props["aria-expanded"], true);
  assert.equal(expandedToggle?.props.accessibilityState?.expanded, true);
  h.state.budget.activeHousehold = { householdId: "home-b", budgetId: "budget-b" }; h.render();
  assert.doesNotMatch(h.text(), /Manual holiday/);
  assert.equal(h.nodes().find(node => /Manual accounts/i.test(node.props.accessibilityLabel ?? ""))?.props["aria-expanded"], false);
  toggle.props.onPress(); h.render();
  assert.doesNotMatch(h.text(), /Manual holiday/, "an old household's toggle cannot expand the new household");
  const currentToggle = h.nodes().find(node => /Manual accounts/i.test(node.props.accessibilityLabel ?? ""));
  assert.ok(currentToggle?.props.onPress);
  currentToggle.props.onPress(); currentToggle.props.onPress(); h.render();
  assert.doesNotMatch(h.text(), /Manual holiday/, "two rapid taps toggle rather than replay a captured visibility flag");
  const manualOnly = harness([manual]); assert.match(manualOnly.text(), /Manual holiday/);
});

test("visible current account navigation selects its exact scoped forecast before routing", () => {
  const h = harness([account(1)]); const row = h.forecast("Saved account 1");
  assert.ok(row?.props.onPress); row.props.onPress();
  assert.deepEqual(h.state.actions, [["select", bankRef(1)], ["push", "/(tabs)/monthly"]]);
});

test("hidden forecast and unavailable accounts keep their balance rows without a route or preference write", () => {
  const h = harness([account(1), account(2, { name: "Foreign currency", currentBalance: null, availableBalance: null, unavailableReason: "Different currency" })]);
  h.state.budget.hiddenForecastAccountRefs = [bankRef(1)]; h.render();
  assert.match(h.text(), /Saved account 1/); assert.match(h.text(), /\$1,000\.00/); assert.match(h.text(), /Forecast off/);
  h.forecast("Saved account 1")?.props.onPress?.(); h.forecast("Foreign currency")?.props.onPress?.();
  assert.deepEqual(h.state.actions, []);
});

test("stale row actions cannot navigate a new household or a removed account", () => {
  const h = harness([account(1)]); const old = h.forecast("Saved account 1"); assert.ok(old?.props.onPress);
  h.state.budget.activeHousehold = { householdId: "home-b", budgetId: "budget-b" }; h.state.budget.forecastAccounts = [account(2)]; h.render(); old.props.onPress();
  assert.deepEqual(h.state.actions, []);
  const latest = h.forecast("Saved account 2"); assert.ok(latest?.props.onPress);
  h.state.budget.forecastAccounts = []; h.render(); latest.props.onPress();
  assert.deepEqual(h.state.actions, []);
  h.state.budget.activeHousehold = { householdId: "home-a", budgetId: "budget-a" };
  h.state.budget.forecastAccounts = [account(1)]; h.render(); old.props.onPress();
  assert.deepEqual(h.state.actions, [], "a previous scope generation cannot reactivate on an A-B-A return");
});

test("loading, failed, or unresolved account scope does not present cached household rows as live balances", () => {
  for (const problem of ["loading", "error", "scope", "core"] as const) {
    const h = harness([account(1, { name: "Cached prior household" })]);
    if (problem === "loading") { h.state.budget.loading = true; h.state.budget.accountForecastReady = false; }
    if (problem === "error") { h.state.budget.loadError = "Load failed"; h.state.budget.accountForecastReady = false; }
    if (problem === "scope") h.state.user = null;
    if (problem === "core") h.state.budget.startupCoreReady = false;
    h.render(); assert.doesNotMatch(h.text(), /Cached prior household|1,000\.00/); assert.equal(h.forecast("Cached prior household"), undefined);
  }
});

test("money privacy masks current, available and accessible currency while preserving source amounts", () => {
  const rows = [account(1, { currentBalance: 1234.56, availableBalance: 1200 }), account(2, { currentBalance: -58.12 }), account(3)];
  const h = harness(rows); const original = structuredClone(rows);
  h.state.hidden = true; h.render();
  const display = h.text() + " " + h.nodes().map(node => [node.props.accessibilityLabel, node.props.accessibilityHint, node.props.title, node.props["aria-label"], JSON.stringify(node.props.accessibilityValue), node.props["aria-valuenow"]].filter(Boolean).join(" ")).join(" ");
  assert.doesNotMatch(display, /1,234\.56|1234\.56|1,200\.00|1200|58\.12|3,000\.00|3000/);
  assert.match(display, /••••/); assert.deepEqual(rows, original);
  h.state.hidden = false; h.render(); assert.match(h.text(), /1,234\.56/); assert.match(h.text(), /1,200\.00/);
});

test("observed balances remain available while forecast display preferences are loading or failed", () => {
  for (const problem of ["preferences", "visibility"] as const) {
    const h = harness([account(1)]);
    if (problem === "preferences") { h.state.budget.accountForecastReady = false; h.state.budget.accountForecastError = "Preferences failed"; }
    else h.state.budget.forecastVisibilityReady = false;
    h.render(); assert.match(h.text(), /Saved account 1/); assert.match(h.text(), /1,000\.00/);
    assert.equal(h.forecast("Saved account 1"), undefined);
    assert.deepEqual(h.state.actions, []);
  }
});

test("queued row actions recheck current readiness, display preference and account eligibility", () => {
  for (const problem of ["loading", "visibility", "preference-error", "visibility-error", "hidden", "unavailable", "balance", "date"] as const) {
    const h = harness([account(1)]); const old = h.forecast("Saved account 1"); assert.ok(old?.props.onPress);
    if (problem === "loading") { h.state.budget.loading = true; h.state.budget.accountForecastReady = false; }
    if (problem === "visibility") h.state.budget.forecastVisibilityReady = false;
    if (problem === "preference-error") h.state.budget.accountForecastError = "Preference unavailable";
    if (problem === "visibility-error") h.state.budget.forecastVisibilityError = "Visibility unavailable";
    if (problem === "hidden") h.state.budget.hiddenForecastAccountRefs = [bankRef(1)];
    if (problem === "unavailable") h.state.budget.forecastAccounts = [account(1, { unavailableReason: "Review link" })];
    if (problem === "balance") h.state.budget.forecastAccounts = [account(1, { currentBalance: null })];
    if (problem === "date") h.state.budget.forecastAccounts = [account(1, { asOfDate: null })];
    h.render(); old.props.onPress(); assert.deepEqual(h.state.actions, [], problem);
  }
});

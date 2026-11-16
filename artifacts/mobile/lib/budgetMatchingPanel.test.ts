import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";

// Run the actual stateless presentation with host primitives; no router exists.
const compiled = ts.transpileModule(readFileSync("components/BudgetMatchingPanel.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const componentModule = { exports: {} as { BudgetMatchingPanel: (props: any) => React.ReactElement } };
new Function("require", "module", "exports", compiled)((name: string) => {
  if (name === "react") return React;
  if (name === "@expo/vector-icons/Feather") return "Icon";
  if (name === "react-native") return { StyleSheet: { create: (value: unknown) => value } };
  if (name.endsWith("PrivacyPrimitives")) return { PrivacyPressable: "Pressable", PrivacyText: "Text", PrivacyView: "View" };
  if (name.endsWith("useColors")) return { useColors: () => ({}) };
  throw new Error(`Unexpected dependency: ${name}`);
}, componentModule, componentModule.exports);
const Panel = componentModule.exports.BudgetMatchingPanel;
function nodes(value: any): any[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
function labelled(tree: any, label: string) {
  const result = nodes(tree).find(node => node.props?.accessibilityLabel === label);
  assert.ok(result, `Missing ${label}`);
  return result.props;
}

test("local Pending/Posted interactions preserve the surrounding draft and invoke existing match callbacks", () => {
  let tab = "pending";
  const draft = { Food: "125.50" };
  const opened: string[] = [];
  const review = React.createElement("review-fixture", { draft });
  const props = { tab, onTabChange: (value: string) => { tab = value; }, pending: [{ id: "bank-charge", name: "Grocer", amount: "−$48.00", date: "Nov 16", account: "Checking", unavailable: false }], postedCount: 1, ready: true, canEdit: true, onOpenPending: (id: string) => opened.push(id), accountPicker: null, children: review };
  let tree = Panel(props);
  labelled(tree, "Match pending payment Grocer").onPress();
  assert.deepEqual(opened, ["bank-charge"]);
  labelled(tree, "Show posted budget activity").onPress();
  tree = Panel({ ...props, tab });
  assert.ok(nodes(tree).includes(review));
  assert.equal(labelled(tree, "Show posted budget activity").accessibilityState.selected, true);
  labelled(tree, "Show pending budget activity").onPress();
  tree = Panel({ ...props, tab });
  assert.equal(labelled(tree, "Show pending budget activity").accessibilityState.selected, true);
  assert.deepEqual(draft, { Food: "125.50" });
});

test("viewers and unavailable source accounts cannot activate pending matches", () => {
  const props = { tab: "pending", onTabChange: () => {}, pending: [{ id: "a", name: "Grocer", amount: "−$48", date: "Nov 16", account: "Checking", unavailable: false }], postedCount: 0, ready: true, canEdit: false, onOpenPending: () => { throw Error("Viewer must not match"); }, accountPicker: null, children: null };
  assert.equal(labelled(Panel(props), "Match pending payment Grocer").disabled, true);
  assert.equal(labelled(Panel({ ...props, canEdit: true, pending: [{ ...props.pending[0], unavailable: true }] }), "Match pending payment Grocer").disabled, true);
  const loading = Panel({ ...props, ready: false });
  assert.equal(nodes(loading).some(node => node.props?.accessibilityLabel === "Match pending payment Grocer"), false);
});

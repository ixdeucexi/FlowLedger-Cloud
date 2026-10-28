import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";

function answerHarness() {
  const state: any[] = []; let cursor = 0;
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const exports: any = {};
  const js = transpileModule(readFileSync("components/FloGroundedAnswer.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exports, (name: string) => name === "react"
    ? { __esModule: true, default: React, useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; } }
    : name === "react-native" ? { Platform: { OS: "web" }, Pressable: "Pressable", View: "View", Text: "Text", StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } }
    : name.endsWith("useColors") ? { useColors: () => new Proxy({}, { get: () => "#123456" }) }
    : name.endsWith("floExperience") ? { floAnswerAsOf: () => "2026-10-28", floSourceDescription: () => "As of Oct 28", floFreshnessLabel: () => "As of Oct 28", safeFloSourceRoute: (route: string) => route }
    : {});
  return (props: any) => { cursor = 0; return exports.FloGroundedAnswer(props); };
}
const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join(" ") : node && typeof node === "object" ? content(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

test("partial metadata has a neutral collapsed details disclosure; specific answer warnings remain visible", () => {
  const render = answerHarness();
  const props = { text: "Recorded balance is $700. This account has an older update date.", partial: true, coverage: "Some details could not be verified", caveat: "The forecast does not include unrecorded spending.", sources: [{ label: "Recorded account balance", route: "/(tabs)/accounts", asOf: "2026-10-28" }], onOpenSource() {}, onFollowUp() {} };
  let tree = render(props);
  assert.match(content(tree), /Recorded balance is \$700/);
  assert.match(content(tree), /older update date/);
  assert.match(content(tree), /Sources & details/);
  assert.doesNotMatch(content(tree), /Partial answer|Some details could not be verified|unrecorded spending/);
  assert.equal(flatten(tree).filter(node => node.props?.accessibilityRole === "alert").length, 0);
  const disclosure = flatten(tree).find(node => node.props?.accessibilityLabel === "Sources and details");
  assert.equal(disclosure.props.accessibilityState.expanded, false); disclosure.props.onPress(); tree = render(props);
  assert.match(content(tree), /Some details could not be verified/);
  assert.match(content(tree), /unrecorded spending/);
  const link = flatten(tree).find(node => node.props?.accessibilityRole === "link"); assert.equal(link.props.href, "/accounts");
  assert.equal(flatten(tree).find(node => node.props?.accessibilityLabel === "Sources and details").props.accessibilityState.expanded, true);
});

test("an answer caveat already present in the reply is not repeated in its details", () => {
  const render = answerHarness(), text = "A date is missing. Check the account before making a payment.";
  const props = { text, caveat: "Check the account before making a payment.", sources: [], onOpenSource() {}, onFollowUp() {} };
  const tree = render(props); flatten(tree).find(node => node.props?.accessibilityLabel === "Sources and details").props.onPress();
  assert.equal(content(render(props)).split(props.caveat).length - 1, 1);
});

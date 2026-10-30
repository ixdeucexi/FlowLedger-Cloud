import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { moneyTextSegments } from "./moneyPrivacy";

function answerHarness(platform = "web") {
  const state: any[] = []; let cursor = 0;
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) };
  const exports: any = {};
  const js = transpileModule(readFileSync("components/FloGroundedAnswer.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exports, (name: string) => name === "react"
    ? { __esModule: true, default: React, useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; } }
    : name === "react-native" ? { Platform: { OS: platform }, Pressable: "Pressable", View: "View", Text: "Text", StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } }
    : name.endsWith("useColors") ? { useColors: () => new Proxy({}, { get: () => "#123456" }) }
    : name.endsWith("floExperience") ? { floAnswerAsOf: () => "2026-10-28", floSourceDescription: () => "As of Oct 28", floFreshnessLabel: () => "As of Oct 28", safeFloSourceRoute: (route: string) => route }
    : name.endsWith("moneyPrivacy") ? { moneyTextSegments }
    : {});
  return (props: any) => { cursor = 0; return exports.FloGroundedAnswer(props); };
}
const flatten = (node: any): any[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join("") : node && typeof node === "object" ? content(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

test("Flo renders only the answer even when source and coverage metadata is present", () => {
  const render = answerHarness();
  const text = "Recorded balance is $700. This account has an older update date.";
  const tree = render({ text, partial: true, coverage: "Some details could not be verified", caveat: "The forecast does not include unrecorded spending.", dataAsOf: "2026-10-28", sources: [{ label: "Recorded account balance", route: "/(tabs)/accounts", asOf: "2026-10-28" }], onOpenSource() {}, onFollowUp() {} });
  assert.equal(content(tree).trim(), text);
  assert.doesNotMatch(content(tree), /Sources|details|Partial answer|Some details could not be verified|unrecorded spending/);
  assert.equal(flatten(tree).filter(node => ["button", "link", "alert"].includes(node.props?.accessibilityRole)).length, 0);
});

test("a warning in the actual answer is preserved without repeating separate metadata", () => {
  const render = answerHarness(), text = "A date is missing. Check the account before making a payment.";
  const tree = render({ text, caveat: "Check the account before making a payment.", sources: [], onOpenSource() {}, onFollowUp() {} });
  assert.equal(content(tree).trim(), text);
  assert.equal(content(tree).split("Check the account before making a payment.").length - 1, 1);
});

test("Flo keeps negative currency together without rewriting answer text or spacing", () => {
  const render = answerHarness();
  const text = "Your checking balance is −$263,682.34.\nPlanned income is $123,456.78 and debt is $9,999,999.99.";
  const tree = render({ text, sources: [], onOpenSource() {}, onFollowUp() {} });
  assert.equal(content(tree), text);
  const negative = flatten(tree).find(node => node.props?.children?.length === 1 && node.props.children[0] === "−$263,682.34");
  assert.ok(negative, "the sign and complete currency amount share one inline run");
});

test("native Flo currency runs keep the answer without receiving web-only text styles", () => {
  const render = answerHarness("ios"), text = "Checking −$263,682.34; reserve $4.2k.";
  const tree = render({ text, sources: [], onOpenSource() {}, onFollowUp() {} });
  assert.equal(content(tree), text);
  const negative = flatten(tree).find(node => node.props?.children?.length === 1 && node.props.children[0] === "−$263,682.34");
  assert.ok(negative);
  assert.equal(negative.props.style, undefined);
});

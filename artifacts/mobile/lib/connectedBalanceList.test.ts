import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { canonicalConnectedAccounts } from "./plaidActivity";

function text(node: any): string { return Array.isArray(node) ? node.map(text).join(" ") : node && typeof node === "object" ? text(node.props?.children) : typeof node === "string" ? node : ""; }
function render(accounts: any[], ready = true) {
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) }, exports: any = {};
  const js = transpileModule(readFileSync("components/ConnectedBalanceList.tsx", "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  new Function("exports", "require", js)(exports, (name: string) => name === "react" ? { __esModule: true, default: React } : name === "react-native" ? { View: "View", Text: "Text", StyleSheet: { create: (value: any) => value } } : name.endsWith("plaidActivity") ? { canonicalConnectedAccounts } : { useColors: () => new Proxy({}, { get: () => "#000000" }) });
  return exports.ConnectedBalanceList({ accounts, ready, timeZone: "America/Chicago" });
}
const account = { id: "cedar", name: "Provider name", display_name: "Cedar checking", account_type: "depository", account_subtype: "checking", current_balance: 700, is_active: true, persistent_account_id: "same", updated_at: "2026-09-10T15:00:00Z" };

test("connected observation source renders canonical saved names and dates without mixing manual balances", () => {
  const value = text(render([account, { ...account, id: "old", display_name: "Old Cedar", current_balance: 600, updated_at: "2026-09-09T15:00:00Z" }, { ...account, id: "off", persistent_account_id: "off", display_name: "Inactive", is_active: false }]));
  assert.match(value, /Cedar checking.*\$700.00.*Updated/s);assert.doesNotMatch(value, /Old Cedar|Inactive|\$600.00/);
  assert.match(value, /not safe-to-spend/);assert.match(value, /Manual accounts are listed separately/);
});

test("scope-unready unavailable and zero connected observations stay distinct and read-only", () => {
  assert.doesNotMatch(text(render([account], false)), /Cedar checking|\$700.00/);
  const unavailable = text(render([{ ...account, current_balance: 0, current_balance_available: false, updated_at: "invalid" }]));
  assert.match(unavailable, /Balance unavailable/);assert.match(unavailable, /Update time unavailable/);assert.doesNotMatch(unavailable, /\$0.00/);
  assert.match(text(render([{ ...account, current_balance: 0 }])), /\$0.00/);
  assert.match(text(render([{ ...account, current_balance: null }])), /Balance unavailable/);
  const source = readFileSync("components/ConnectedBalanceList.tsx", "utf8");assert.doesNotMatch(source, /Pressable|supabase|fetch\(|useEffect/);
  const more = readFileSync("app/(tabs)/more.tsx", "utf8");assert.match(more, /ConnectedBalanceList accounts=\{connectedBankAccounts\} ready=\{startupCoreReady && !budgetLoading && !budgetLoadError\}/);
});

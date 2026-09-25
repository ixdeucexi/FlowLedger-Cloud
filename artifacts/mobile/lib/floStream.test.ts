import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLO_CLIENT_RESPONSE_TIMEOUT_MS, floFailureDisplay, floStreamErrorCode, isFloTerminalEvent, isFloTimeoutCode, parseFloSseChunk } from "./floStream";

test("parses grounded Flo v3 events split across arbitrary chunks", () => {
  const first = parseFloSseChunk("", 'data: {"type":"meta","version":3,"conversationId":"c","assistantMessageId":"a","dataAsOf":"2026-08-12T12:00:00Z","partial":false}\n\ndata: {"type":"text-');
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.type, "meta");
  const second = parseFloSseChunk(first.pending, 'delta","delta":"Hello"}\n\ndata: {"type":"sources","sources":[{"id":"accounts:1","type":"account","label":"Checking","asOf":"2026-08-10T12:00:00Z","freshness":"stale","route":"/(tabs)/accounts"}]}\n\ndata: {"type":"followups","items":["Why did it change?"]}\n\ndata: {"type":"proposal","proposal":null}\n\ndata: {"type":"done","messageId":"a","answer":{"answer":"Hello","caveat":"One connected account is stale.","dataAsOf":"2026-08-10T12:00:00Z","coverage":{"complete":false},"partial":true,"followups":["Why did it change?"]}}\n\n');
  assert.deepEqual(second.events.map(event => event.type), ["text-delta", "sources", "followups", "proposal", "done"]);
  assert.equal(second.pending, "");
  const done = second.events.at(-1);
  assert.equal(done?.type === "done" ? done.answer?.caveat : null, "One connected account is stale.");
  assert.equal(done?.type === "done" ? done.answer?.dataAsOf : null, "2026-08-10T12:00:00Z");
  assert.equal(done?.type === "done" ? done.answer?.partial : null, true);
});

test("ignores malformed and provider done events without losing valid events", () => {
  const parsed = parseFloSseChunk("", 'data: nope\n\ndata: [DONE]\n\ndata: {"type":"status","message":"Reading records"}\n\n');
  assert.deepEqual(parsed.events, [{ type: "status", message: "Reading records" }]);
});

test("only done and typed error events terminate a Flo stream", () => {
  assert.equal(isFloTerminalEvent({ type: "meta", conversationId: "c", assistantMessageId: "a" }), false);
  assert.equal(isFloTerminalEvent({ type: "status", message: "Reading records" }), false);
  assert.equal(isFloTerminalEvent({ type: "done", messageId: "a", text: "Verified" }), true);
  assert.equal(isFloTerminalEvent({ type: "error", code: "upstream", message: "Try again" }), true);
});

test("parses verified no-history cleanup after the answer", () => {
  const parsed = parseFloSseChunk("", 'data: {"type":"done","messageId":"a","text":"Answer"}\n\ndata: {"type":"ephemeral-cleanup","status":"completed"}\n\n');
  assert.deepEqual(parsed.events.map(event => event.type), ["done", "ephemeral-cleanup"]);
});

test("preserves typed cleanup failure after a completed answer", () => {
  const parsed = parseFloSseChunk("", 'data: {"type":"done","messageId":"a","text":"Answer"}\n\ndata: {"type":"error","code":"ephemeral_cleanup_failed","message":"Flo could not clear this no-history chat."}\n\n');
  assert.deepEqual(parsed.events.map(event => event.type), ["done", "error"]);
  assert.equal(floStreamErrorCode(parsed.events[1]!), "ephemeral_cleanup_failed");
});

test("Flo has a bounded client response window and recognizes timeout failures", () => {
  assert.equal(FLO_CLIENT_RESPONSE_TIMEOUT_MS, 50_000);
  assert.equal(isFloTimeoutCode("answer_timeout"), true);
  assert.equal(isFloTimeoutCode("flo_timeout"), true);
  assert.equal(isFloTimeoutCode("answer_failed"), false);
});

test("parses a verified recovery answer without treating it as terminal", () => {
  const parsed = parseFloSseChunk("", 'data: {"type":"verified-fallback","fallback":{"answer":"Open the planner.","sources":[{"type":"help","label":"Debt Payoff Planner","route":"/snowball-plan"}],"partial":true}}\n\n');
  assert.equal(parsed.events[0]?.type, "verified-fallback");
  assert.equal(parsed.events[0]?.type === "verified-fallback" ? parsed.events[0].fallback.answer : null, "Open the planner.");
  assert.equal(isFloTerminalEvent(parsed.events[0]!), false);
});

test("saved interrupted Flo streams render a useful message instead of an empty bubble", () => {
  const source = readFileSync("lib/floChat.ts", "utf8");
  assert.match(source, /That earlier Flo check was interrupted/);
  assert.match(source, /Flo is finishing this account check/);
  assert.match(source, /staleStream \? "error" : status/);
  assert.match(source, /status === "error" && !storedText.trim\(\)/);
  assert.match(source, /floFailureDisplay\(row.error_code\)/);
});

test("Flo distinguishes expired sessions, limits, and deleted conversations from missing account data", () => {
  const session = floFailureDisplay("session_required");
  assert.match(session.action, /Sign in again/);
  assert.equal(session.retryable, false);
  const daily = floFailureDisplay("usage_limited");
  assert.match(daily.action, /tomorrow/);
  assert.equal(daily.retryable, false);
  assert.match(floFailureDisplay("rate_limited").action, /Wait a minute/);
  const deleted = floFailureDisplay("conversation_deleted");
  assert.match(deleted.answer, /deleted while I was answering/);
  assert.match(deleted.action, /New/);
  assert.equal(deleted.retryable, false);
  assert.match(floFailureDisplay("audit_unavailable").answer, /couldn't save/);
  assert.equal(floFailureDisplay("answer_timeout").retryable, true);
  assert.equal(floFailureDisplay("internal secret detail").answer.includes("secret"), false);
});

test("history cannot delete an active answer or hydrate over a newly sent question", () => {
  const screen = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const bar = readFileSync("components/FloConversationBar.tsx", "utf8");
  const send = screen.slice(screen.indexOf("const send = async"), screen.indexOf("const acceptAiConsent"));
  assert.match(send, /const requestGeneration = nextFloRequestGeneration\(requestGenerationRef.current\)/);
  assert.match(screen, /loadGeneration !== requestGenerationRef.current/);
  const deleteAll = screen.slice(screen.indexOf("const removeAllConversations"), screen.indexOf("const exportConversations"));
  assert.match(deleteAll, /activeRequestRef.current !== null \|\| historyMutationRef.current/);
  assert.ok(deleteAll.indexOf("streamAbortRef.current?.abort()") < deleteAll.indexOf("await deleteAllFloConversations"));
  assert.match(bar, /disabled=\{!props.conversations.length \|\| busy \|\| props.disabled\} onPress=\{\(\) => setConfirmDeleteAll/);
  assert.match(bar, /if \(busy \|\| props.disabled\) return/);
});

test("temporary context is only sent with history disabled", () => {
  const source = readFileSync("lib/floChat.ts", "utf8");
  const screen = readFileSync("app/(tabs)/flo.tsx", "utf8");
  assert.match(source, /input.historyEnabled === false \? \{ conversationContext: input.conversationContext \?\? \[\] \} : \{\}/);
  assert.match(screen, /floConversationForRequest\(floPreferences.historyEnabled, priorRequest\?\.conversationId \?\? activeConversationId\)/);
  assert.match(screen, /preferences.historyEnabled !== floPreferences.historyEnabled\) retryRequestRef.current = null/);
});

test("send and route prompts wait for scoped history preferences and controls lock during a request", () => {
  const screen = readFileSync("app/(tabs)/flo.tsx", "utf8");
  const bar = readFileSync("components/FloConversationBar.tsx", "utf8");
  const preferences = readFileSync("lib/floPreferences.ts", "utf8");
  const send = screen.slice(screen.indexOf("const send = async"), screen.indexOf("const acceptAiConsent"));
  assert.match(send, /if \(!aiConsentReady \|\| !preferencesReady\) return/);
  assert.ok(send.indexOf("!preferencesReady") < send.indexOf("createFloConversation"));
  assert.match(screen, /floPreferencesReadyForScope\(preferencesScopeKey, floDataScopeKey\)/);
  assert.match(screen, /!aiConsentReady \|\| !preferencesReady \|\| !user\?\.id/);
  assert.match(screen, /editable=\{!historyBusy && preferencesReady\}/);
  assert.match(screen, /loadedScope !== floDataScopeKeyRef.current/);
  assert.match(preferences, /catch \{[\s\S]*historyEnabled: false/);
  assert.match(bar, /Boolean\(props.disabled \|\| props.preferencesDisabled\)/);
  assert.match(bar, /Switch accessibilityLabel=\{label\} disabled=\{disabled\}/);
});

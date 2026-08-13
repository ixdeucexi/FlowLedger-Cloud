import assert from "node:assert/strict";
import test from "node:test";

import { FLO_CLIENT_RESPONSE_TIMEOUT_MS, floStreamErrorCode, isFloTerminalEvent, isFloTimeoutCode, parseFloSseChunk } from "./floStream";

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
  assert.equal(FLO_CLIENT_RESPONSE_TIMEOUT_MS, 35_000);
  assert.equal(isFloTimeoutCode("answer_timeout"), true);
  assert.equal(isFloTimeoutCode("flo_timeout"), true);
  assert.equal(isFloTimeoutCode("answer_failed"), false);
});

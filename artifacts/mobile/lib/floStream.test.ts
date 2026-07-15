import assert from "node:assert/strict";
import test from "node:test";

import { parseFloSseChunk } from "./floStream";

test("parses Flo v2 events split across arbitrary chunks", () => {
  const first = parseFloSseChunk("", 'data: {"type":"meta","conversationId":"c","assistantMessageId":"a"}\n\ndata: {"type":"text-');
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.type, "meta");
  const second = parseFloSseChunk(first.pending, 'delta","delta":"Hello"}\n\ndata: {"type":"done","messageId":"a"}\n\n');
  assert.deepEqual(second.events.map(event => event.type), ["text-delta", "done"]);
  assert.equal(second.pending, "");
});

test("ignores malformed and provider done events without losing valid events", () => {
  const parsed = parseFloSseChunk("", 'data: nope\n\ndata: [DONE]\n\ndata: {"type":"status","message":"Reading records"}\n\n');
  assert.deepEqual(parsed.events, [{ type: "status", message: "Reading records" }]);
});

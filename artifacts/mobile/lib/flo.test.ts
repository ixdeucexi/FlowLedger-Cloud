import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_USAGE_UNAVAILABLE_MESSAGE,
  localFloAnswer,
  normalizeFloError,
  normalizeFloReply,
  reduceFloChat,
  sanitizeFloSummary,
  type FloChatState,
  type FloFacts,
} from "./floPolicy";

const facts: FloFacts = {
  balanceToday: 1000,
  lowestBalance: 800,
  lowestBalanceDate: "2026-07-01",
  safetyFloor: 200,
  monthlyIncome: 4000,
  monthlyBills: 2000,
  upcoming: [{ name: "Power", amount: 120, date: "2026-06-28" }],
  activePlans: 0,
  forecastConfidence: "high",
};
const days = [{ date: "2026-06-24", balance: 1000 }, { date: "2026-07-01", balance: 800 }];

test("Flo affordability uses deterministic result", () => {
  assert.match(localFloAnswer("Can I afford $700 on 2026-06-24?", facts, days) ?? "", /^Not safely\./);
});

test("all Flo quick prompts work without AI", () => {
  assert.match(localFloAnswer("Can I afford $500?", facts, days) ?? "", /Yes/);
  assert.match(localFloAnswer("What bills are due next?", facts, days) ?? "", /Power/);
  assert.match(localFloAnswer("Why does my balance run low?", facts, days) ?? "", /lowest point/);
  assert.match(localFloAnswer("How do I add income?", facts, days) ?? "", /Add Income/);
});

test("chat input appends the user message and Flo response in order", () => {
  const start: FloChatState = { messages: [], sending: false };
  const submitted = reduceFloChat(start, { type: "submit", id: "user-1", text: "  Hello Flo  " });
  assert.deepEqual(submitted, {
    messages: [{ id: "user-1", role: "user", text: "Hello Flo" }],
    sending: true,
  });
  const replied = reduceFloChat(submitted, { type: "reply", id: "flo-1", text: "Hi!" });
  assert.equal(replied.messages[1]?.role, "flo");
  assert.equal(replied.messages[1]?.text, "Hi!");
  assert.equal(replied.sending, false);
});

test("chat input ignores blank and duplicate submissions while sending", () => {
  const start: FloChatState = { messages: [], sending: false };
  assert.equal(reduceFloChat(start, { type: "submit", id: "blank", text: "  " }), start);
  const sending = reduceFloChat(start, { type: "submit", id: "user-1", text: "Hello" });
  assert.equal(reduceFloChat(sending, { type: "submit", id: "user-2", text: "Again" }), sending);
});

test("AI quota and billing failures use the friendly fallback", () => {
  assert.equal(normalizeFloReply("OpenAI quota exceeded"), AI_USAGE_UNAVAILABLE_MESSAGE);
  assert.equal(normalizeFloReply("AI usage is currently unavailable"), AI_USAGE_UNAVAILABLE_MESSAGE);
  assert.equal(normalizeFloReply(null, 429), AI_USAGE_UNAVAILABLE_MESSAGE);
});

test("Edge Function failures never leak technical errors into chat", () => {
  assert.equal(
    normalizeFloError("Failed to send a request to the Edge Function"),
    "Flo couldn't connect just now. Your FlowLedger calculations are still available, so please try again.",
  );
});

test("Flo memory strips financial and identifying values", () => {
  const value = sanitizeFloSummary("john@example.com asked about $2,450 on 2026-12-01");
  assert.equal(value.includes("2450"), false);
  assert.equal(value.includes("john@"), false);
});

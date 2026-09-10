import assert from "node:assert/strict";
import test from "node:test";

import { collectFloHistoryPages, floAnswerAsOf, floConversationForRequest, floEphemeralCleanupError, floFreshnessLabel, floSourceDescription, floProposalMatchesAuthoritative, isFloRequestGenerationCurrent, nextFloRequestGeneration, oldestFloSourceAsOf, safeFloSourceRoute, searchFloHistory } from "./floExperience";

test("searchFloHistory matches titles and summaries without changing order", () => {
  const rows = [
    { id: "1", title: "August forecast", summary: "Tightest forecast point", updatedAt: "2026-08-12" },
    { id: "2", title: "Debt plan", summary: "Camera payoff", updatedAt: "2026-08-11" },
  ];
  assert.deepEqual(searchFloHistory(rows, "camera"), [rows[1]]);
  assert.deepEqual(searchFloHistory(rows, "  "), rows);
});

test("safeFloSourceRoute allows internal destinations only", () => {
  assert.equal(safeFloSourceRoute("/(tabs)/transactions?search=rent"), "/(tabs)/transactions?search=rent");
  assert.equal(safeFloSourceRoute("https://example.com"), null);
  assert.equal(safeFloSourceRoute("//example.com"), null);
  assert.equal(safeFloSourceRoute("/(tabs)/../admin"), null);
  assert.equal(safeFloSourceRoute("/(tabs)/unknown"), null);
  assert.equal(safeFloSourceRoute("/(tabs)\\transactions"), null);
});

test("floFreshnessLabel explains recent and unavailable timestamps", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");
  assert.equal(floFreshnessLabel("2026-08-12T11:58:00.000Z", now), "Updated 2 min ago");
  assert.equal(floFreshnessLabel(undefined, now), "Freshness unavailable");
});

test("oldestFloSourceAsOf uses the least fresh valid supporting source", () => {
  assert.equal(oldestFloSourceAsOf([
    { asOf: "2026-08-12T11:58:00.000Z" },
    { asOf: "not-a-date" },
    { asOf: "2026-08-10T09:00:00.000Z" },
    {},
  ]), "2026-08-10T09:00:00.000Z");
  assert.equal(oldestFloSourceAsOf([{ asOf: "invalid" }]), undefined);
});

test("Flo date-only evidence preserves the recorded calendar day without inventing an update time", () => {
  assert.equal(floFreshnessLabel("2026-09-09", new Date("2026-09-10T01:00:00Z")),
    `As of ${new Date(2026, 8, 9, 12).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  assert.equal(floFreshnessLabel("2026-02-30"), "Freshness unavailable");
});

test("saved Flo answers recover date-only precision from matching JSON evidence", () => {
  const sources = [{ asOf: "2026-09-09" }];
  const restored = floAnswerAsOf("2026-09-09T00:00:00+00:00", sources);
  assert.equal(restored, "2026-09-09");
  assert.match(floFreshnessLabel(restored), /^As of /);
  assert.equal(floAnswerAsOf("2026-09-08T12:00:00Z", sources), "2026-09-08T12:00:00Z");
  assert.equal(floAnswerAsOf(null, sources), "2026-09-09");
  assert.equal(floAnswerAsOf(null, []), undefined);
  const timestampSource = { asOf: "2026-09-09T00:00:00Z" };
  for (const mixed of [[timestampSource, ...sources], [...sources, timestampSource]]) {
    assert.equal(oldestFloSourceAsOf(mixed), "2026-09-09");
    assert.equal(floAnswerAsOf("2026-09-09T00:00:00+00:00", mixed), "2026-09-09");
  }
});

test("Flo distinguishes app guidance, saved scenarios, and unknown source dates", () => {
  assert.equal(floSourceDescription({ type: "help", label: "Plan Simulator", asOf: "2026-06-24" }), "App guidance");
  assert.equal(floSourceDescription({ type: "account", label: "Checking", asOf: null }), "Update time unavailable");
  assert.match(floSourceDescription({ type: "decision", label: "Test", recordId: "simulation:a", asOf: "2026-06-24" }), /^Saved scenario · As of /);
  assert.match(floSourceDescription({ type: "debt", label: "Plan", id: "getDebtPlanHistory:a", asOf: "2026-06-24" }), /^Saved debt plan · As of /);
  assert.match(floSourceDescription({ type: "decision", label: "Purchase", recordId: "decision:a", asOf: null }), /^Saved decision · Update time unavailable/);
  assert.match(floSourceDescription({ type: "account", label: "Checking", freshness: "stale", asOf: "2026-06-24" }), /^Older record · As of /);
});

test("collectFloHistoryPages includes retained history beyond the first 50 rows", async () => {
  const rows = Array.from({ length: 73 }, (_, index) => index + 1);
  const ranges: Array<[number, number]> = [];
  const collected = await collectFloHistoryPages(async (from, to) => {
    ranges.push([from, to]);
    return rows.slice(from, to + 1);
  });
  assert.deepEqual(collected, rows);
  assert.deepEqual(ranges, [[0, 49], [50, 99]]);
});

test("proposal review fails closed when message payload differs from authoritative proposal", () => {
  const authoritative = { id: "p", kind: "recurring_bill_change", title: "Change bill", summary: "Review", expiresAt: "2026-08-12T13:00:00Z", payload: { billId: "b", expectedAmount: 50, newAmount: 60 } };
  assert.equal(floProposalMatchesAuthoritative(authoritative, authoritative), true);
  assert.equal(floProposalMatchesAuthoritative({ ...authoritative, payload: { ...authoritative.payload, newAmount: 55 } }, authoritative), false);
});

test("a household generation change rejects late Flo stream events", () => {
  assert.equal(isFloRequestGenerationCurrent(4, 4), true);
  assert.equal(isFloRequestGenerationCurrent(4, 5), false);
});

test("New conversation rejects a delayed event from the prior conversation", () => {
  const delayedRequestGeneration = 8;
  assert.equal(isFloRequestGenerationCurrent(delayedRequestGeneration, nextFloRequestGeneration(delayedRequestGeneration)), false);
});

test("selecting history rejects a delayed event from the previously active conversation", () => {
  const delayedRequestGeneration = 12;
  assert.equal(isFloRequestGenerationCurrent(delayedRequestGeneration, nextFloRequestGeneration(delayedRequestGeneration)), false);
});

test("history-off never reuses a retained active conversation", () => {
  assert.equal(floConversationForRequest(false, "retained-thread"), null);
  assert.equal(floConversationForRequest(true, "retained-thread"), "retained-thread");
});

test("history-off surfaces a server cleanup failure", () => {
  assert.match(floEphemeralCleanupError(false) ?? "", /could not be cleaned up/i);
  assert.equal(floEphemeralCleanupError(true), null);
});

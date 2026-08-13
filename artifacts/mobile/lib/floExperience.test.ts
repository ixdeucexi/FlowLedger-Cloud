import assert from "node:assert/strict";
import test from "node:test";

import { collectFloHistoryPages, floConversationForRequest, floEphemeralCleanupError, floFreshnessLabel, floProposalMatchesAuthoritative, isFloRequestGenerationCurrent, nextFloRequestGeneration, oldestFloSourceAsOf, safeFloSourceRoute, searchFloHistory } from "./floExperience";

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

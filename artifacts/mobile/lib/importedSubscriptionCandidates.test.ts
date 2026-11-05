import assert from "node:assert/strict";
import test from "node:test";
import { importedSubscriptionDecisionUpdate, importedSubscriptionMetadata, mergeImportedSubscriptionCandidates, parseImportedSubscriptionCandidates } from "./importedSubscriptionCandidates";

const household = "11111111-1111-4111-8111-111111111111";
const row = { id: "22222222-2222-4222-8222-222222222222", household_id: household, merchant: "Stream Box", status: "review", cadence: "monthly", average_amount: 12.99, monthly_equivalent: 12.99, yearly_equivalent: 155.88, confidence: "high", source_transaction_ids: [], initial_import_version: 1, initial_import_item_id: "33333333-3333-4333-8333-333333333333", source_plaid_transaction_ids: ["ledger-evidence-only"] };

test("new-profile history flags stay visible without inventing a cash transaction", () => {
  const imported = parseImportedSubscriptionCandidates([row], household);
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0]!.transactionIds, []);
  assert.equal(imported[0]!.evidenceOnly, true);
  assert.deepEqual(imported[0]!.sourcePlaidTransactionIds, ["ledger-evidence-only"]);
  assert.equal(mergeImportedSubscriptionCandidates([], imported).length, 1);
  assert.equal(importedSubscriptionMetadata(imported[0]!)!.savedCandidateId, row.id);
});

test("foreign, legacy, malformed and empty evidence rows do not become new flags", () => {
  assert.deepEqual(parseImportedSubscriptionCandidates([
    { ...row, household_id: "foreign" }, { ...row, initial_import_version: null },
    { ...row, average_amount: -1 }, { ...row, id: "not-a-row-id" },
    { ...row, source_plaid_transaction_ids: [] },
  ], household), []);
});

test("merchant merge keeps persisted identity and richer local amounts with canonical IDs only", () => {
  const [imported] = parseImportedSubscriptionCandidates([row], household);
  const local = { ...imported!, merchant: "stream box", averageAmount: 15.99, lastAmount: 17.99, priceIncrease: true, transactionIds: ["real-canonical-row"] };
  const merged = mergeImportedSubscriptionCandidates([local], [imported!]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.averageAmount, 15.99);
  assert.equal(merged[0]!.priceIncrease, true);
  assert.deepEqual(merged[0]!.transactionIds, ["real-canonical-row"]);
  assert.equal(importedSubscriptionMetadata(merged[0]!)!.evidenceOnly, true);
  assert.deepEqual(importedSubscriptionMetadata(merged[0]!)!.persistedTransactionIds, []);
  assert.equal(importedSubscriptionMetadata(merged[0]!)!.savedCandidateId, row.id);
});

test("canonical bill conversion evidence preserves persisted order rather than merged local IDs", () => {
  const [imported] = parseImportedSubscriptionCandidates([{ ...row, source_transaction_ids: ["canonical-z", "canonical-a"] }], household);
  const merged = mergeImportedSubscriptionCandidates([{ ...imported!, transactionIds: ["local-extra", "canonical-a"] }], [imported!]);
  assert.deepEqual(importedSubscriptionMetadata(merged[0]!)!.persistedTransactionIds, ["canonical-z", "canonical-a"]);
  assert.equal(importedSubscriptionMetadata(merged[0]!)!.evidenceOnly, false);
});

test("saved review decisions survive subsequent loads and never overwrite evidence", () => {
  const handled = parseImportedSubscriptionCandidates([{ ...row, status: "keep" }], household);
  assert.deepEqual(mergeImportedSubscriptionCandidates([], handled), []);
  const dismissed = parseImportedSubscriptionCandidates([{ ...row, status: "not_subscription", source_transaction_ids: ["canonical"] }], household);
  assert.deepEqual(mergeImportedSubscriptionCandidates([dismissed[0]!], dismissed), []);
  assert.deepEqual(importedSubscriptionDecisionUpdate("keep", "2026-11-05T18:00:00Z", "reviewing-editor"), { user_id: "reviewing-editor", status: "keep", last_reviewed_at: "2026-11-05T18:00:00Z", updated_at: "2026-11-05T18:00:00Z" });
});

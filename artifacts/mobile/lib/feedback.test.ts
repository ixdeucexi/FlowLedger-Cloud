import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitFeedback,
  customerFeedbackReply,
  feedbackStatusLabel,
  feedbackStatusMessage,
  normalizeFeedbackStatus,
  normalizeFeedbackType,
  sanitizeFeedbackMessage,
} from "./feedback";

assert.equal(canSubmitFeedback(""), false);
assert.equal(canSubmitFeedback("ok"), false);
assert.equal(canSubmitFeedback("App froze on setup"), true);

assert.equal(sanitizeFeedbackMessage("  App     froze     here  "), "App  froze  here");
assert.equal(sanitizeFeedbackMessage("x".repeat(4100)).length, 4000);

assert.equal(normalizeFeedbackType("bug"), "bug");
assert.equal(normalizeFeedbackType("bad-value"), "other");

assert.equal(normalizeFeedbackStatus("fixed"), "fixed");
assert.equal(normalizeFeedbackStatus("bad-value"), "new");
assert.equal(feedbackStatusLabel("fixed"), "Updated");
assert.equal(feedbackStatusLabel("wont_fix"), "Not planned");
assert.match(feedbackStatusMessage("fixed"), /now live/i);
assert.match(feedbackStatusMessage("wont_fix"), /not planned/i);

test("customer update copy keeps the screenshot's feature change and removes release records", () => {
  const note = "LIVE: Close bucket is available in the bucket editor and opens the existing Review Center closing choices. Planned/spent history and posted transactions are preserved. The request is consumed once, preventing canceled dialogs from replaying after navigation or refresh. Release commit 1d9c9e1c818fc2ad1503568631d740ca7fce3cef; deployment dpl_937suxb9BF3P441WnNXGUcys71yR. Full Release checks run 39469443087 passed. Rollback: rollback/prod-before-planner-bucket-updates-20261020.";
  assert.equal(
    customerFeedbackReply(note, "fixed"),
    "You can now close a bucket from its editor. Your past activity stays saved.",
  );
});

test("ordinary customer replies retain meaningful wording and cautions", () => {
  const note = "The category name now stays saved. Your history stays available. Please refresh before editing again.";
  assert.equal(customerFeedbackReply(note, "fixed"), note);
  for (const status of ["new", "reviewing", "wont_fix"] as const) {
    const reply = "We cannot add this yet. Keep your current setup until we reply.";
    assert.equal(customerFeedbackReply(reply, status), reply);
  }
});

test("release metadata alone never becomes an invented feature summary", () => {
  for (const note of [
    "LIVE: Release commit 1d9c9e1c818fc2ad1503568631d740ca7fce3cef",
    "Full Release\nchecks run 39469443087 passed.",
    "Rollback: rollback/prod-before-planner-bucket-updates-20261020",
    "deployment dpl_example",
    "1d9c9e1c818fc2ad1503568631d740ca7fce3cef",
    "   ",
  ]) assert.equal(customerFeedbackReply(note, "fixed"), null, note);
  assert.equal(customerFeedbackReply(null, "fixed"), null);
  assert.equal(customerFeedbackReply(undefined, "new"), null);
});

test("legacy summaries keep decimal amounts and use at most two feature sentences", () => {
  assert.equal(
    customerFeedbackReply("LIVE: Payments of $12.99 now match correctly. Bill dates stay saved. The internal retry path was changed.", "fixed"),
    "Payments of $12.99 now match correctly. Bill dates stay saved.",
  );
  assert.equal(
    customerFeedbackReply("LIVE:\nYou can edit a goal.\nYour progress stays saved.\nRelease commit abcdef0.", "fixed"),
    "You can edit a goal. Your progress stays saved.",
  );
});

test("a normal mention of tests or deployment is not treated as an engineering record", () => {
  const reply = "Test transactions now keep their category. The Deployment category is still available.";
  assert.equal(customerFeedbackReply(reply, "fixed"), reply);
  assert.equal(customerFeedbackReply("Rollback: use Undo to restore a recent change.", "fixed"), "Rollback: use Undo to restore a recent change.");
  assert.equal(customerFeedbackReply("LIVE: Test transactions now keep their category. Your history stays saved.", "fixed"), "Test transactions now keep their category. Your history stays saved.");
});

test("incomplete outcomes are not rewritten as a completed change", () => {
  const note = "The bucket change needs more review. Please keep using the current editor. Your existing entries are safe. Release commit abcdef0.";
  assert.equal(customerFeedbackReply(note, "reviewing"), "The bucket change needs more review. Please keep using the current editor. Your existing entries are safe.");
  assert.equal(feedbackStatusMessage("new"), "Received.");
  assert.equal(feedbackStatusMessage("reviewing"), "Under review.");
  assert.equal(feedbackStatusMessage("wont_fix"), "Not planned.");
});

test("long legacy copy ends at a word boundary within the compact public length", () => {
  const reply = customerFeedbackReply(`LIVE: ${"A longer feature description ".repeat(25)}now works.`, "fixed");
  assert.ok(reply);
  assert.ok(reply.length <= 320);
  assert.ok(reply.endsWith("…"));
});

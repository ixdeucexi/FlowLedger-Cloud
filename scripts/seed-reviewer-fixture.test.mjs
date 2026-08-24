import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./seed-reviewer-fixture.mjs", import.meta.url), "utf8");
const fixture = JSON.parse(await readFile(new URL("../store-assets/v1/fixture/reviewer-v1.json", import.meta.url), "utf8"));

test("reviewer fixture is explicitly fictional, guarded and credential-free", () => {
  assert.equal(fixture.version, 1);
  assert.equal(typeof fixture.householdName, "string");
  assert.match(source, /FLOWLEDGER_REVIEWER_FIXTURE_CONFIRM/);
  assert.match(source, /flowledger_reviewer_fixture/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(JSON.stringify(fixture), /access_token|password|secret|plaid_item/i);
});

test("Founding Free reviewer stays Free and existing elevated plans fail closed", () => {
  assert.doesNotMatch(source, /tier: "pro", source: "admin"/);
  assert.doesNotMatch(source, /source: "billing"/);
  assert.doesNotMatch(source, /from\("feedback_admins"\)/);
  assert.match(source, /flowledger_store_reviewer/);
  assert.match(source, /billing_sandbox_testers/);
  assert.match(source, /tier: "free", source: "default"/);
  assert.match(source, /existingPlan\.source !== "default" \|\| existingPlan\.tier !== "free"/);
  assert.match(source, /Founding Free reviewer must use a fresh Free account/);
});

test("reviewer fixture activates a fully onboarded household-scoped budget", () => {
  assert.match(source, /from\("household_settings"\)\.upsert/);
  assert.match(source, /budget_id: budget\.id/);
  assert.match(source, /onboarding_completed: true/);
  assert.match(source, /payment_method: "snowball", planning_mode: "snowball"/);
  assert.match(source, /from\("user_preferences"\)\.upsert/);
  assert.match(source, /active_household_id: household\.id/);
});

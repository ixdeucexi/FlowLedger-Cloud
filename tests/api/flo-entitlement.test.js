const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function entitlementModule() {
  const file = path.resolve(__dirname, "../../supabase/functions/flo-chat/entitlement.ts");
  return import(pathToFileURL(file).href);
}

test("Flo Pro enforcement fails closed when the setting is missing", async () => {
  const { isFloProEnforcementEnabled } = await entitlementModule();
  assert.equal(isFloProEnforcementEnabled(undefined), true);
  assert.equal(isFloProEnforcementEnabled("true"), true);
  assert.equal(isFloProEnforcementEnabled("false"), false);
});

test("account-aware Flo allows Pro and verified admin previews only", async () => {
  const { canUseFloAccountChat } = await entitlementModule();
  assert.equal(canUseFloAccountChat(true, "free", null), false);
  assert.equal(canUseFloAccountChat(true, "pro", null), true);
  assert.equal(canUseFloAccountChat(true, "free", "pro"), true);
  assert.equal(canUseFloAccountChat(false, "free", null), true);
});

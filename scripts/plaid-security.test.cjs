const assert = require("node:assert/strict");
const test = require("node:test");

const plaidUtils = require("../api/_utils/plaid");

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

test.afterEach(() => {
  restoreEnv();
});

test("Plaid client reports missing server configuration clearly", () => {
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  delete process.env.PLAID_ENV;

  assert.throws(
    () => plaidUtils.getPlaidClient(),
    error => {
      assert.equal(error.name, "PlaidConfigurationError");
      assert.equal(error.code, "PLAID_CONFIGURATION_MISSING");
      assert.deepEqual(error.missing, ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"]);
      return true;
    },
  );
});

test("PLAID_ENV=production maps to the Plaid production environment", () => {
  process.env.PLAID_CLIENT_ID = "test-client-id";
  process.env.PLAID_SECRET = "test-secret";
  process.env.PLAID_ENV = "production";

  assert.equal(plaidUtils.plaidEnv(), "production");
  assert.doesNotThrow(() => plaidUtils.getPlaidClient());
});

test("Plaid access-token encryption round trips with a 32 byte key", () => {
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  const encrypted = plaidUtils.encryptAccessToken("access-production-secret");
  assert.match(encrypted, /^v1:/);
  assert.notEqual(encrypted.includes("access-production-secret"), true);
  assert.equal(plaidUtils.decryptAccessToken(encrypted), "access-production-secret");
});

test("Plaid token encryption rejects invalid key lengths", () => {
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = "too-short";

  assert.throws(
    () => plaidUtils.encryptAccessToken("access-token"),
    error => {
      assert.equal(error.name, "PlaidConfigurationError");
      assert.equal(error.code, "PLAID_CONFIGURATION_MISSING");
      assert.ok(error.missing.includes("PLAID_TOKEN_ENCRYPTION_KEY"));
      return true;
    },
  );
});

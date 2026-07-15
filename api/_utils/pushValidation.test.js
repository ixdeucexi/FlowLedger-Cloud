const assert = require("node:assert/strict");
const test = require("node:test");

const { validPushEndpoint, validPushKey } = require("./pushValidation");

test("push subscriptions require an HTTPS endpoint", () => {
  assert.equal(validPushEndpoint("https://push.example.test/subscription/123"), true);
  assert.equal(validPushEndpoint("http://push.example.test/subscription/123"), false);
  assert.equal(validPushEndpoint("not-a-url"), false);
});

test("push encryption keys accept only bounded base64url values", () => {
  assert.equal(validPushKey("abcdefghijklmnopqrstuvwxyz_123456", 20, 512), true);
  assert.equal(validPushKey("too-short", 20, 512), false);
  assert.equal(validPushKey("abcdefghijklmnopqrstuvwxyz+/123", 20, 512), false);
});

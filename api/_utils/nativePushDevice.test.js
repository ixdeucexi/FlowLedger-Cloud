const assert = require("node:assert/strict");
const test = require("node:test");

const { nativePushRegistrationKey, normalizeNativePushDevice, validExpoPushToken } = require("./nativePushDevice");

const firstInstall = "11111111-1111-4111-8111-111111111111";
const secondInstall = "22222222-2222-4222-8222-222222222222";
const householdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const householdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function device(overrides = {}) {
  return normalizeNativePushDevice({ installationId: firstInstall, householdId: householdA, token: "ExponentPushToken[abcdefghijklmnop]", platform: "android", environment: "production", ...overrides });
}

test("Expo tokens and native device inputs fail closed", () => {
  assert.equal(validExpoPushToken("ExponentPushToken[abcdefghijklmnop]"), true);
  assert.equal(validExpoPushToken("https://attacker.invalid/token"), false);
  assert.equal(device({ platform: "web" }), null);
  assert.equal(device({ householdId: "wrong" }), null);
});

test("household switch updates the same installation registration", () => {
  const first = device();
  const switched = device({ householdId: householdB });
  assert.equal(nativePushRegistrationKey(userA, first), nativePushRegistrationKey(userA, switched));
  assert.notEqual(first.householdId, switched.householdId);
});

test("multiple devices and reinstall get independent registration keys", () => {
  const first = device();
  const second = device({ installationId: secondInstall, token: "ExpoPushToken[qrstuvwxyz123456]" });
  assert.notEqual(nativePushRegistrationKey(userA, first), nativePushRegistrationKey(userA, second));
});

test("a different signed-in user cannot share the same registration key", () => {
  const first = device();
  const userB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  assert.notEqual(nativePushRegistrationKey(userA, first), nativePushRegistrationKey(userB, first));
});

import assert from "node:assert/strict";
import test from "node:test";

import { parseSecureAuthManifest, splitSecureAuthValue } from "./secureAuthStorageCodec";

test("secure auth values split without changing their content", () => {
  const value = "a".repeat(4301);
  const chunks = splitSecureAuthValue(value, 1800);
  assert.deepEqual(chunks.map(chunk => chunk.length), [1800, 1800, 701]);
  assert.equal(chunks.join(""), value);
});

test("secure auth manifest accepts only bounded safe generations", () => {
  assert.deepEqual(parseSecureAuthManifest('{"version":1,"generation":"safe-id-1","chunks":3}'), {
    version: 1,
    generation: "safe-id-1",
    chunks: 3,
  });
  assert.equal(parseSecureAuthManifest('{"version":1,"generation":"../bad","chunks":3}'), null);
  assert.equal(parseSecureAuthManifest('{"version":1,"generation":"safe","chunks":0}'), null);
});

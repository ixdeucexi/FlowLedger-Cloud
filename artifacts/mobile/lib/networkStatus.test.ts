import assert from "node:assert/strict";
import test from "node:test";

import {
  OfflineMutationError,
  assertMutationOnline,
  guardedMutationFetch,
  publishNetworkStatus,
  reachableNetworkState,
} from "./networkStatus";

test("native connectivity fails closed when the device or internet is unavailable", () => {
  assert.equal(reachableNetworkState({ isConnected: false, isInternetReachable: null }), false);
  assert.equal(reachableNetworkState({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(reachableNetworkState({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(reachableNetworkState({ isConnected: true, isInternetReachable: null }), null);
  assert.equal(reachableNetworkState({ isConnected: null, isInternetReachable: true }), null);
  assert.equal(reachableNetworkState({ isConnected: null, isInternetReachable: null }), null);
});

test("writes fail closed while offline or native reachability is unknown", () => {
  publishNetworkStatus(null);
  assert.throws(() => assertMutationOnline("https://example.test/rest/v1/bills", { method: "POST" }), OfflineMutationError);
  publishNetworkStatus(false);
  assert.throws(() => assertMutationOnline("/api/plaid/sync", { method: "POST" }), /not saved/i);
  assert.doesNotThrow(() => assertMutationOnline("https://example.test/rest/v1/bills", { method: "GET" }));
  assert.doesNotThrow(() => assertMutationOnline("https://example.test/auth/v1/token", { method: "POST" }));
});

test("guarded fetch never sends an offline mutation and resumes after reconnect", async () => {
  let requests = 0;
  const fakeFetch = (async () => { requests += 1; return new Response(null, { status: 204 }); }) as typeof fetch;
  const guarded = guardedMutationFetch(fakeFetch);
  publishNetworkStatus(false);
  assert.throws(() => guarded("https://example.test/rest/v1/bills", { method: "PATCH" }), /not saved/i);
  assert.equal(requests, 0);
  publishNetworkStatus(true);
  const response = await guarded("https://example.test/rest/v1/bills", { method: "PATCH" });
  assert.equal(response.status, 204);
  assert.equal(requests, 1);
});

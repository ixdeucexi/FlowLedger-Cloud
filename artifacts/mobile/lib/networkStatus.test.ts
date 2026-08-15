import assert from "node:assert/strict";
import test from "node:test";

import { reachableNetworkState } from "./networkStatus";

test("native connectivity fails closed when the device or internet is unavailable", () => {
  assert.equal(reachableNetworkState({ isConnected: false, isInternetReachable: null }), false);
  assert.equal(reachableNetworkState({ isConnected: true, isInternetReachable: false }), false);
  assert.equal(reachableNetworkState({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(reachableNetworkState({ isConnected: null, isInternetReachable: null }), true);
});

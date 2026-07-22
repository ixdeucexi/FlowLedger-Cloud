import assert from "node:assert/strict";
import test from "node:test";

import { WEB_VIEWPORT_CONTENT } from "./webViewport";

test("web viewport keeps mobile sizing without blocking accessibility zoom", () => {
  assert.match(WEB_VIEWPORT_CONTENT, /width=device-width/);
  assert.match(WEB_VIEWPORT_CONTENT, /viewport-fit=cover/);
  assert.doesNotMatch(WEB_VIEWPORT_CONTENT, /user-scalable=no/);
  assert.doesNotMatch(WEB_VIEWPORT_CONTENT, /maximum-scale=1(?:\D|$)/);
});

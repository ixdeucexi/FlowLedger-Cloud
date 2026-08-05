import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_MODAL_COMPACT,
  DESKTOP_MODAL_OVERLAY,
  DESKTOP_MODAL_REGULAR,
  DESKTOP_MODAL_WIDE,
} from "./desktopModal";

test("desktop overlays center dialogs with breathing room", () => {
  assert.equal(DESKTOP_MODAL_OVERLAY.alignItems, "center");
  assert.equal(DESKTOP_MODAL_OVERLAY.justifyContent, "center");
  assert.equal(DESKTOP_MODAL_OVERLAY.paddingHorizontal, 32);
  assert.equal(DESKTOP_MODAL_OVERLAY.paddingVertical, 28);
});

test("desktop dialogs use deliberate size tiers instead of full-width sheets", () => {
  assert.equal(DESKTOP_MODAL_COMPACT.maxWidth, 480);
  assert.equal(DESKTOP_MODAL_REGULAR.maxWidth, 580);
  assert.equal(DESKTOP_MODAL_WIDE.maxWidth, 660);
  assert.equal(DESKTOP_MODAL_COMPACT.maxHeight, "86%");
  assert.equal(DESKTOP_MODAL_REGULAR.borderRadius, 24);
  assert.equal(DESKTOP_MODAL_WIDE.width, "100%");
});

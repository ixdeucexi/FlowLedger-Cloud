import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampFloPosition,
  createFloDragSession,
  floLauncherBounds,
  readFloPosition,
  rememberFloPosition,
  shouldStartFloDrag,
} from "./floLauncherPosition";
import {
  dismissFloLauncher,
  isFloLauncherDismissed,
  restoreFloLauncher,
} from "./floLauncherVisibility";

const zeroInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const mobile = floLauncherBounds(
  { width: 390, height: 844 },
  { width: 106, height: 54 },
  zeroInsets,
  false,
);

test("complete logo and X footprint stays above navigation and inside every edge", () => {
  assert.deepEqual(mobile, { minX: 12, maxX: 268, minY: 12, maxY: 692 });
  for (const point of [
    { x: -999, y: -999 },
    { x: 9999, y: 9999 },
    { x: -999, y: 9999 },
    { x: 9999, y: -999 },
  ]) {
    const next = clampFloPosition(point, mobile);
    assert.ok(next.x >= 12 && next.x + 106 <= 374);
    assert.ok(next.y >= 12 && next.y + 54 <= 746);
  }
  const safe = floLauncherBounds(
    { width: 390, height: 844 },
    { width: 106, height: 54 },
    { top: 44, right: 5, bottom: 34, left: 5 },
    false,
  );
  assert.deepEqual(safe, { minX: 17, maxX: 263, minY: 56, maxY: 658 });
});

test("bounds are local to desktop content, and include the entire Undo control", () => {
  const desktop = floLauncherBounds(
    { width: 800, height: 600 },
    { width: 240, height: 54 },
    zeroInsets,
    true,
  );
  assert.deepEqual(desktop, { minX: 12, maxX: 536, minY: 12, maxY: 522 });
  const undo = floLauncherBounds(
    { width: 320, height: 600 },
    { width: 208, height: 54 },
    zeroInsets,
    false,
  );
  assert.equal(undo.maxX + 208, 304);
  assert.equal(undo.maxY + 54, 502);
});

test("resize and page remount preserve session-relative position without persistence", () => {
  rememberFloPosition(
    { x: mobile.maxX / 2 + mobile.minX / 2, y: mobile.maxY },
    mobile,
  );
  const resized = floLauncherBounds(
    { width: 844, height: 390 },
    { width: 106, height: 54 },
    zeroInsets,
    false,
  );
  const next = readFloPosition(resized);
  assert.equal(next.x, (resized.minX + resized.maxX) / 2);
  assert.equal(next.y, resized.maxY);
  assert.deepEqual(readFloPosition(resized), next);
  const small = floLauncherBounds(
    { width: 106, height: 54 },
    { width: 106, height: 54 },
    zeroInsets,
    false,
  );
  assert.deepEqual(clampFloPosition(next, small), { x: 0, y: 0 });
});

test("threshold distinguishes a tap from drag; dragging back still suppresses navigation", () => {
  const gesture = createFloDragSession();
  gesture.begin({ x: 100, y: 200 });
  assert.equal(shouldStartFloDrag(7, 0), false);
  assert.equal(shouldStartFloDrag(8, 0), true);
  assert.equal(gesture.move(7, 0, mobile), null);
  assert.equal(gesture.canActivate(), true);
  assert.deepEqual(gesture.move(8, 0, mobile), { x: 108, y: 200 });
  assert.equal(gesture.canActivate(), false);
  assert.deepEqual(gesture.move(0, 0, mobile), { x: 100, y: 200 });
  assert.equal(gesture.canActivate(), false);
  gesture.finish(mobile);
  assert.equal(gesture.canActivate(), false);
  gesture.begin({ x: 100, y: 200 });
  assert.equal(gesture.canActivate(), true);
});

test("release, cancellation and hold cannot accidentally open or hide Flo", () => {
  restoreFloLauncher();
  const gesture = createFloDragSession();
  gesture.begin({ x: 100, y: 200 });
  gesture.move(900, -900, mobile);
  assert.deepEqual(gesture.finish(mobile), { x: mobile.maxX, y: mobile.minY });
  assert.equal(isFloLauncherDismissed(), false);
  assert.equal(gesture.canActivate(), false);
  gesture.begin({ x: 100, y: 200 });
  gesture.cancel(mobile);
  assert.equal(gesture.canActivate(), false);
  gesture.begin({ x: 100, y: 200 });
  gesture.suppressActivation();
  assert.equal(gesture.canActivate(), false);
  assert.equal(isFloLauncherDismissed(), false);
  dismissFloLauncher();
  assert.equal(isFloLauncherDismissed(), true);
  restoreFloLauncher();
  assert.equal(isFloLauncherDismissed(), false);
});

test("component isolates drag handle, provides visible X and preserves timed Undo", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "FloLauncher.tsx"),
    "utf8",
  );
  assert.match(source, /UNDO_DURATION_MS = 5000/);
  assert.match(source, /pointerEvents="box-none"/);
  assert.match(source, /onLayout=/);
  assert.match(source, /<View\s+\{\.\.\.panResponder.panHandlers\}/);
  assert.match(source, /accessibilityLabel="Hide Flo shortcut"/);
  assert.match(source, /name="x" size=\{20\} color=\{c.foreground\}/);
  assert.match(source, /closeButton: \{\s*width: 44,\s*height: 44/);
  assert.doesNotMatch(source, /onLongPress=\{hideLauncher\}|AsyncStorage/);
  assert.match(source, /onPanResponderTerminate/);
  assert.match(source, /if \(!dragSession.canActivate\(\)\) return/);
  assert.match(source, /touchAction: "none"/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { adjacentChipScrollOffset, chipScrollMaximum } from "./chipScroll";

test("debt arrows visit every nonuniform chip boundary without skipping readable choices", () => {
  const offsets = [0, 267, 534, 625, 1000, 1240, 1507, 1774, 2041, 2308, 2575, 2842];
  const viewport = 655, content = 3109;
  const visited = [0];
  for (let i = 0; i < 20; i++) {
    const next = adjacentChipScrollOffset(visited.at(-1)!, viewport, content, 1, offsets);
    if (next === visited.at(-1)) break;
    visited.push(next);
  }
  assert.deepEqual(visited, [0, 267, 534, 625, 1000, 1240, 1507, 1774, 2041, 2308, 2454]);
  offsets.forEach((start, index) => {
    const end = (offsets[index + 1] ?? content) - 7;
    assert.ok(visited.some(offset => start >= offset && end <= offset + viewport), `chip ${index} never fully visible`);
  });
  let offset = visited.at(-1)!;
  for (let i = 0; i < 20; i++) offset = adjacentChipScrollOffset(offset, viewport, content, -1, offsets);
  assert.equal(offset, 0);
  assert.equal(adjacentChipScrollOffset(400, viewport, content, -1, offsets), 267);
});
test("fitting content, unmeasured choices and resize/content shrink clamp correctly", () => {
  assert.equal(chipScrollMaximum(300, 200), 0);
  assert.equal(adjacentChipScrollOffset(0, 300, 200, 1, [0, 100]), 0);
  assert.equal(adjacentChipScrollOffset(800, 400, 600, 1, [0, 150, 350]), 200);
  assert.equal(adjacentChipScrollOffset(0, 200, 1000, 1, []), 0);
  assert.equal(adjacentChipScrollOffset(0, 200, 1000, 1, [420, 0, 100]), 100);
});
test("desktop-only debt arrows scroll without choosing, while touch and explicit chip selection remain", () => {
  const source = readFileSync("components/SimulatorChoiceChips.tsx", "utf8");
  assert.match(source, /desktopDebtNavigation && isDesktop && containerWidth > 0 && contentWidth > containerWidth \+ 1/);
  assert.match(source, /onContentSizeChange=\{width => setContentWidth\(width\)\}/);
  assert.match(source, /onLayout=\{event => setViewportWidth/);
  assert.match(source, /offsetRef.current <= maximum/);
  const scroll = source.slice(source.indexOf("  const scroll ="), source.indexOf("  const arrow ="));
  assert.match(scroll, /scrollTo\(\{ x: next/);
  assert.doesNotMatch(scroll, /onSelect/);
  assert.match(source, /onPress=\{\(\) => onSelect\(value.id\)\}/);
  assert.match(source, /aria-checked=\{active\}/);
  assert.match(source, /offset <= 1 : offset >= maximum - 1/);
  assert.match(source, /const x = event.nativeEvent.layout.x/);
  assert.match(source, /maxWidth: debtChipMaxWidth/);
  assert.match(source, /values.map\(value => chipPositions\[value.id\]\)/);
  assert.match(source, /ids.has\(id\)/);
});

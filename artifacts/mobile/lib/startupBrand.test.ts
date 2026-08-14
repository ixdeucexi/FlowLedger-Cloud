import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("startup brand uses one root-owned opacity entrance without resizing", () => {
  const layout = readFileSync("app/_layout.tsx", "utf8");
  const brand = readFileSync("components/StartupPlanBrand.tsx", "utf8");
  const index = readFileSync("app/index.tsx", "utf8");

  assert.match(layout, /brandEntranceOpacity = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(layout, /const STARTUP_BRAND_FADE_MS = 1200/);
  assert.match(layout, /const STARTUP_BRAND_HOLD_MS = 300/);
  assert.match(layout, /const APP_REVEAL_MS = 700/);
  assert.match(layout, /duration: STARTUP_BRAND_FADE_MS/);
  assert.match(layout, /easing: Easing\.inOut\(Easing\.quad\)/);
  assert.match(layout, /`\$\{STARTUP_BRAND_FADE_MS\}ms`/);
  assert.match(layout, /transitionProperty: "opacity"/);
  assert.match(layout, /transitionTimingFunction: "ease-in-out"/);
  assert.match(layout, /STARTUP_BRAND_FADE_MS \+ STARTUP_BRAND_HOLD_MS/);
  assert.match(layout, /\[brandEntranceReady, brandEntranceStarted, reduceMotion\]/);
  assert.match(layout, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(layout, /setWebExitStarted\(true\)/);
  assert.match(layout, /APP_REVEAL_MS \+ 80/);
  assert.match(layout, /leaving=\{webExitStarted\}/);
  assert.match(layout, /if \(reduceMotion\)[\s\S]*brandEntranceOpacity\.setValue\(1\)/);
  assert.match(layout, /const appReady = coreReady && planReady && minimumStartupReady && brandEntranceReady/);
  assert.doesNotMatch(layout, /brandEntranceOpacity[\s\S]{0,160}(scale|width|height)/);

  assert.match(brand, /const STARTUP_LOGO_SIZE = 200/);
  assert.match(brand, /width: STARTUP_LOGO_SIZE/);
  assert.match(brand, /height: STARTUP_LOGO_SIZE/);
  assert.match(brand, /flexShrink: 0/);

  assert.match(index, /<StartupPlanBrand \/>/);
  assert.doesNotMatch(index, /Animated|timing|opacity/);
});

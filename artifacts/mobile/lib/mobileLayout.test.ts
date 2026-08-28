import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nativeTabBarMetrics, tabBarDisplayLabel, tabBarLabelSize } from "./mobileLayout";

test("tab labels shrink under enlarged-text viewport pressure", () => {
  assert.equal(tabBarLabelSize(240), 8);
  assert.equal(tabBarLabelSize(260), 8);
  assert.equal(tabBarLabelSize(275), 8);
  assert.equal(tabBarLabelSize(300), 8);
  assert.equal(tabBarLabelSize(312), 8);
  assert.equal(tabBarLabelSize(330), 8);
  assert.equal(tabBarLabelSize(340), 10);
  assert.equal(tabBarLabelSize(360), 10);
});

test("long tab labels use readable compact names under zoom pressure", () => {
  assert.equal(tabBarDisplayLabel("Dashboard", 260), "Home");
  assert.equal(tabBarDisplayLabel("Forecast", 260), "Forecast");
  assert.equal(tabBarDisplayLabel("Activity", 260), "Activity");
  assert.equal(tabBarDisplayLabel("Dashboard", 312), "Home");
  assert.equal(tabBarDisplayLabel("Forecast", 330), "Forecast");
  assert.equal(tabBarDisplayLabel("Dashboard", 340), "Dashboard");
  assert.equal(tabBarDisplayLabel("Dashboard", 360), "Dashboard");
});

test("primary tabs mount on first use, retain state, and detach when hidden", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");

  assert.match(tabLayout, /<Tabs[\s\S]*?detachInactiveScreens\s/);
  assert.match(tabLayout, /freezeOnBlur: !isWeb/);
  assert.match(tabLayout, /lazy: true/);
  assert.doesNotMatch(tabLayout, /lazy: isAdd/);
});

test("the protected workspace cannot publish empty startup badge counts", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  assert.match(
    tabLayout,
    /React\.useEffect\(\(\) => \{\s*if \(!dataUpdatedAt\) return;\s*void syncAppBadge\(notificationCount\)/,
  );
});

test("native tab bar reserves the real Android navigation inset", () => {
  assert.deepEqual(nativeTabBarMetrics(0), { height: 86, paddingBottom: 14 });
  assert.deepEqual(nativeTabBarMetrics(24), { height: 96, paddingBottom: 24 });
  assert.deepEqual(nativeTabBarMetrics(Number.NaN), { height: 86, paddingBottom: 14 });
});

test("native tab layout uses safe-area metrics instead of a fixed height", () => {
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");

  assert.match(tabLayout, /nativeTabBarMetrics\(insets\.bottom\)/);
  assert.match(tabLayout, /height: nativeTabMetrics\.height/);
  assert.match(tabLayout, /paddingBottom: nativeTabMetrics\.paddingBottom/);
  assert.doesNotMatch(tabLayout, /height: 86,\s*paddingTop: 6,\s*paddingBottom: 14/);
});

test("native Activity and Flo overlays reserve Android system insets", () => {
  const activity = readFileSync("app/(tabs)/transactions.tsx", "utf8");
  const flo = readFileSync("app/(tabs)/flo.tsx", "utf8");

  assert.match(activity, /Math\.max\(insets\.top, 28\)/);
  assert.match(activity, /paddingTop: activityTopInset \+ 12 \+ webTopPad/);
  assert.match(flo, /paddingBottom: Math\.max\(insets\.bottom, 16\)/);
  assert.match(flo, /maxHeight: "100%"/);
  assert.match(flo, /contentContainerStyle=\{styles\.aiConsentContent\}/);
});

test("native dashboard gives the full balance card an opaque surface", () => {
  const dashboard = readFileSync("app/(tabs)/index.tsx", "utf8");

  assert.match(dashboard, /const heroSurface = Platform\.OS === "web"/);
  assert.match(dashboard, /c\.isDark\s*\? "#050816"/);
  assert.equal((dashboard.match(/backgroundColor: heroSurface/g) ?? []).length, 2);
});

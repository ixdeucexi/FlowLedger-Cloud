import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseDesktopExperience } from "./desktopExperience";

test("enables the desktop workspace for wide desktop browsers", () => {
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1440,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }),
    true,
  );
});

test("keeps native apps and narrow web sessions on the existing layout", () => {
  assert.equal(
    shouldUseDesktopExperience({ platform: "ios", viewportWidth: 1440 }),
    false,
  );
  assert.equal(
    shouldUseDesktopExperience({ platform: "web", viewportWidth: 899 }),
    false,
  );
});

test("never replaces the phone experience, even at an unusual wide viewport", () => {
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1024,
      userAgentMobile: true,
      userAgent: "Mozilla/5.0 (Linux; Android 16; Mobile)",
    }),
    false,
  );
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1024,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
    }),
    false,
  );
});

test("uses two-column desktop mode for tablet browsers but not installed tablet PWAs", () => {
  const ipadBrowser = {
    platform: "web",
    viewportWidth: 1024,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    maxTouchPoints: 5,
  };

  assert.equal(shouldUseDesktopExperience(ipadBrowser), true);
  assert.equal(
    shouldUseDesktopExperience({ ...ipadBrowser, standalone: true }),
    false,
  );
});

test("allows an installed desktop PWA to use the desktop workspace", () => {
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1280,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      standalone: true,
    }),
    true,
  );
});

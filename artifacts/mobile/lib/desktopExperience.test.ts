import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseDesktopExperience } from "./desktopExperience";

test("keeps wide desktop browsers on the same responsive experience as the PWA", () => {
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1440,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }),
    false,
  );
});

test("keeps native apps and narrow web sessions on the existing layout", () => {
  assert.equal(
    shouldUseDesktopExperience({ platform: "ios", viewportWidth: 1440 }),
    false,
  );
  assert.equal(
    shouldUseDesktopExperience({ platform: "web", viewportWidth: 1023 }),
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

test("does not change the experience when a tablet app is installed", () => {
  const ipadBrowser = {
    platform: "web",
    viewportWidth: 1024,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    maxTouchPoints: 5,
  };

  assert.equal(shouldUseDesktopExperience(ipadBrowser), false);
  assert.equal(
    shouldUseDesktopExperience({ ...ipadBrowser, standalone: true }),
    false,
  );
});

test("does not change the experience when a desktop app is installed", () => {
  assert.equal(
    shouldUseDesktopExperience({
      platform: "web",
      viewportWidth: 1280,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      standalone: true,
    }),
    false,
  );
});

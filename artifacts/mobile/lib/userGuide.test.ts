import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FLOWLEDGER_USER_GUIDE_FILENAME,
  FLOWLEDGER_USER_GUIDE_PAGE_TITLES,
  FLOWLEDGER_USER_GUIDE_PATH,
  FLOWLEDGER_USER_GUIDE_ROUTE,
  flowLedgerUserGuidePageFromOffset,
  flowLedgerUserGuideTarget,
  flowLedgerUserGuideUrl,
} from "./userGuide";

test("user guide uses one stable public PDF path", () => {
  assert.equal(FLOWLEDGER_USER_GUIDE_FILENAME, "FlowLedger-User-Guide.pdf");
  assert.equal(FLOWLEDGER_USER_GUIDE_PATH, "/FlowLedger-User-Guide.pdf");
  assert.equal(
    flowLedgerUserGuideUrl(),
    "/FlowLedger-User-Guide.pdf",
  );
});

test("user guide can use the current web origin without a double slash", () => {
  assert.equal(
    flowLedgerUserGuideUrl("https://preview.example.com/"),
    "https://preview.example.com/FlowLedger-User-Guide.pdf",
  );
});

test("the mobile layout opens the current ten-page swipe guide", () => {
  assert.equal(FLOWLEDGER_USER_GUIDE_PAGE_TITLES.length, 10);
  assert.deepEqual(flowLedgerUserGuideTarget("mobile"), {
    kind: "mobile",
    href: FLOWLEDGER_USER_GUIDE_ROUTE,
  });
});

test("the website keeps opening the PDF", () => {
  assert.deepEqual(
    flowLedgerUserGuideTarget("website", "https://preview.example.com/"),
    {
      kind: "pdf",
      href: "https://preview.example.com/FlowLedger-User-Guide.pdf",
    },
  );
});

test("the in-app guide matches the current navigation and launch plan", () => {
  const guideScreen = readFileSync("app/user-guide.tsx", "utf8");
  const desktopSettings = readFileSync(
    "components/desktop/DesktopSettingsPage.tsx",
    "utf8",
  );
  const tabLayout = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const pdfBuilder = readFileSync("../../scripts/build-user-guide.py", "utf8");
  const guideCatalog = JSON.parse(
    readFileSync("lib/userGuideContent.json", "utf8"),
  ) as Array<{
    eyebrow: string;
    title: string;
    intro: string;
    icon: string;
    accent: string;
    sections: Array<{
      title: string;
      items: Array<{ title: string; body: string; icon: string }>;
    }>;
    callout: { title: string; body: string };
  }>;
  const serializedCatalog = JSON.stringify(guideCatalog);

  assert.equal(guideCatalog.length, 10);
  assert.deepEqual(
    guideCatalog.map((slide) => slide.title),
    FLOWLEDGER_USER_GUIDE_PAGE_TITLES,
  );
  assert.ok(
    guideCatalog.every(
      (slide) =>
        slide.eyebrow &&
        slide.title &&
        slide.intro &&
        slide.icon &&
        /^#[0-9A-F]{6}$/i.test(slide.accent) &&
        slide.sections.length > 0 &&
        slide.sections.every(
          (section) =>
            section.title &&
            section.items.length > 0 &&
            section.items.every(
              (item) => item.title && item.body && item.icon,
            ),
        ) &&
        slide.callout.title &&
        slide.callout.body,
    ),
  );
  assert.match(serializedCatalog, /Review Activity and match what happened/);
  assert.match(serializedCatalog, /Settings, setup, and Founding Free/);
  assert.match(serializedCatalog, /Dashboard → Next up → Activity → Forecast/);
  assert.match(serializedCatalog, /saved real closing balance/);
  assert.match(serializedCatalog, /Pro is planned for a later release/);
  assert.doesNotMatch(
    serializedCatalog,
    /2027|Today.?s Decisions|actual close|projected close/i,
  );
  assert.match(
    guideScreen,
    /import guideSlidesContent from "@\/lib\/userGuideContent\.json"/,
  );
  assert.match(guideScreen, /accessibilityLiveRegion="polite"/);
  assert.match(guideScreen, /accessibilityRole="header"/);
  assert.match(desktopSettings, /router\.push\("\/user-guide" as never\)/);
  assert.doesNotMatch(desktopSettings, /flowLedgerUserGuideTarget|Linking\.openURL/);
  assert.match(
    tabLayout,
    /accessibilityElementsHidden[\s\S]+importantForAccessibility="no-hide-descendants"[\s\S]+learningTarget/,
  );
  assert.doesNotMatch(
    guideScreen,
    /const GUIDE_SLIDES[^=]*=\s*\[/,
  );
  assert.doesNotMatch(serializedCatalog, /assets\/images\/user-guide/);
  assert.doesNotMatch(serializedCatalog, /Each connected or manual savings/);
  assert.match(serializedCatalog, /When bank sync is available/);
  assert.match(pdfBuilder, /CONTENT\s*=.*userGuideContent\.json/);
  assert.match(pdfBuilder, /CONTENT\.read_bytes\(\)/);
  assert.match(pdfBuilder, /FlowLedgerGuideSourceSHA256/);
  assert.match(
    guideScreen,
    /accessibilityElementsHidden=\{!active\}[\s\S]+importantForAccessibility=\{active \? "auto" : "no-hide-descendants"\}/,
  );
  assert.match(guideScreen, /extraData=\{currentPage\}/);
  assert.doesNotMatch(pdfBuilder, /Today.?s Decisions|projected close|actual close/i);
});

test("the swipe guide derives its footer page from the actual scroll position", () => {
  assert.equal(flowLedgerUserGuidePageFromOffset(0, 390), 0);
  assert.equal(flowLedgerUserGuidePageFromOffset(390, 390), 1);
  assert.equal(flowLedgerUserGuidePageFromOffset(390 * 5, 390), 5);
  assert.equal(flowLedgerUserGuidePageFromOffset(390 * 20, 390), 9);
  assert.equal(flowLedgerUserGuidePageFromOffset(-390, 390), 0);
});

import assert from "node:assert/strict";
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
    "https://flowledger-algo.com/FlowLedger-User-Guide.pdf",
  );
});

test("user guide can use the current web origin without a double slash", () => {
  assert.equal(
    flowLedgerUserGuideUrl("https://preview.example.com/"),
    "https://preview.example.com/FlowLedger-User-Guide.pdf",
  );
});

test("the mobile layout opens the eight-page swipe guide", () => {
  assert.equal(FLOWLEDGER_USER_GUIDE_PAGE_TITLES.length, 8);
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

test("the swipe guide derives its footer page from the actual scroll position", () => {
  assert.equal(flowLedgerUserGuidePageFromOffset(0, 390), 0);
  assert.equal(flowLedgerUserGuidePageFromOffset(390, 390), 1);
  assert.equal(flowLedgerUserGuidePageFromOffset(390 * 5, 390), 5);
  assert.equal(flowLedgerUserGuidePageFromOffset(390 * 20, 390), 7);
  assert.equal(flowLedgerUserGuidePageFromOffset(-390, 390), 0);
});

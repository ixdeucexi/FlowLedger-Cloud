import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOWLEDGER_USER_GUIDE_FILENAME,
  FLOWLEDGER_USER_GUIDE_PATH,
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

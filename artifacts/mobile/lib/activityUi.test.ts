import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobileActivity = readFileSync("app/(tabs)/transactions.tsx", "utf8");
const desktopActivity = readFileSync(
  "components/desktop/DesktopActivityPage.tsx",
  "utf8",
);

test("Activity uses the competitive money-movement hierarchy on phone and desktop", () => {
  assert.match(mobileActivity, /MONEY MOVEMENT/);
  assert.match(mobileActivity, /NET FLOW/);
  assert.match(mobileActivity, /Inflows/);
  assert.match(mobileActivity, /Outflows/);
  assert.match(mobileActivity, /Recent Activity/);
  assert.match(mobileActivity, /accessibilityLabel="Add activity"/);
  assert.match(
    mobileActivity,
    /accessibilityLabel="Export visible activity as CSV"/,
  );

  assert.match(desktopActivity, /NET MOVEMENT/);
  assert.match(desktopActivity, /title="Spending Mix"/);
  assert.match(desktopActivity, /summaryIsPartial/);
  assert.doesNotMatch(desktopActivity, /SummaryMetricCard/);
});

test("Activity keeps exact money and accessible modal and touch-target contracts", () => {
  assert.match(mobileActivity, /function formatActivityMoney/);
  assert.doesNotMatch(mobileActivity, /toFixed\(0\)/);
  assert.match(mobileActivity, /accessibilityViewIsModal/g);
  assert.match(
    mobileActivity,
    /sourceIcon:\s*\{[\s\S]*?width: 44,[\s\S]*?height: 44,/,
  );
  assert.match(
    mobileActivity,
    /modalCloseButton:\s*\{[\s\S]*?width: 44,[\s\S]*?height: 44,/,
  );
});

test("Activity reuses the complete account-aware ledger and keeps filtered weekly totals honest", () => {
  assert.match(
    mobileActivity,
    /BudgetContext already loads the complete, account-aware transaction ledger/,
  );
  assert.match(
    mobileActivity,
    /selectFlowLedgerTransactions\(\s*transactions,\s*transactionAccountIdentities,\s*\)\.included/,
  );
  assert.match(mobileActivity, /const historyHasMore = false/);
  assert.doesNotMatch(
    mobileActivity,
    /ACTIVITY_PAGE_SIZE|historyTransactions|dateIdKeysetFilter/,
  );
  assert.match(
    mobileActivity,
    /weeks:\s*usesCompletePlannedSummary\s*\?\s*monthSummaryBasis\.weeks/,
  );
  assert.match(mobileActivity, /Weekly totals reflect loaded results only\./);
});

test("review and pending attention remain separate actionable destinations", () => {
  assert.match(
    mobileActivity,
    /const unmatchedPendingActivity = useMemo\([\s\S]*?unmatchedPendingTransactions/,
  );
  assert.match(
    mobileActivity,
    /unmatchedPendingTransactions\([\s\S]*?\.filter\(\(transaction\) => Number\(transaction\.amount\) < -0\.005\)/,
  );
  assert.match(
    mobileActivity,
    /const openFirstUnmatchedPending = \(\) => \{[\s\S]*?setPendingMatchTx\(pending\);/,
  );
  assert.match(mobileActivity, /REVIEW POSTED ACTIVITY/);
  assert.match(mobileActivity, /MATCH PENDING/);
  assert.match(mobileActivity, /accessibilityHint="Opens Review Center"/);
  assert.match(mobileActivity, /"Opens pending match options"/);
  assert.match(mobileActivity, /onPress=\{openFirstUnmatchedPending\}/);
  assert.match(
    mobileActivity,
    /activityReviewCount > 0 \? \([\s\S]*?router\.push[\s\S]*?pendingActivityCount > 0 \? \([\s\S]*?onPress=\{openFirstUnmatchedPending\}/,
  );
  assert.match(mobileActivity, /\? "Match pending"/);
  assert.match(mobileActivity, /: "Deposit pending"/);
  assert.doesNotMatch(mobileActivity, /activityAttentionCount/);
});

test("compact desktop Activity keeps its hero and feed at intrinsic height", () => {
  assert.match(
    desktopActivity,
    /netFlowBlockStack:\s*\{[\s\S]*?flexBasis: "auto"/,
  );
  assert.match(
    desktopActivity,
    /activityCardStack:\s*\{[\s\S]*?flexBasis: "auto"/,
  );
  assert.match(
    desktopActivity,
    /flowSupportGridStack:\s*\{[\s\S]*?flexBasis: "auto"/,
  );
  assert.doesNotMatch(desktopActivity, /activityCardStack:\s*\{\s*flex: 0/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shared press controls enforce a 44-point minimum target", () => {
  const source = readFileSync("components/AccessiblePressable.tsx", "utf8");
  assert.match(source, /minWidth:\s*44/);
  assert.match(source, /minHeight:\s*44/);
  assert.match(source, /accessibilityRole\s*=\s*"button"/);
});

test("critical destructive and notification journeys expose live errors and modal focus", () => {
  const deletion = readFileSync("app/delete-account.tsx", "utf8");
  const confirmation = readFileSync("components/ConfirmActionModal.tsx", "utf8");
  const notifications = readFileSync("components/NotificationCenterModal.tsx", "utf8");
  assert.match(deletion, /accessibilityRole="alert"/);
  assert.match(confirmation, /setAccessibilityFocus/);
  assert.match(confirmation, /accessibilityLiveRegion="assertive"/);
  assert.match(notifications, /accessibilityViewIsModal/);
  assert.match(notifications, /setAccessibilityFocus/);
  assert.doesNotMatch(confirmation, /ref=\{dialogRef\}[\s\S]{0,80}accessible/);
  assert.doesNotMatch(notifications, /ref=\{dialogRef\}[\s\S]{0,80}accessible/);
  assert.match(confirmation, /ref=\{titleRef\} accessibilityRole="header"/);
  assert.match(notifications, /ref=\{titleRef\} accessibilityRole="header"/);
  assert.match(notifications, /<View style=\{\[styles\.backdrop/);
  assert.doesNotMatch(notifications, /<Pressable[^>]*style=\{\[styles\.backdrop/);
  assert.match(notifications, /<Pressable accessible=\{false\} accessibilityElementsHidden/);
});

test("contained confirmations use a native modal so TalkBack cannot reach background actions", () => {
  const source = readFileSync("components/ConfirmActionModal.tsx", "utf8");
  const overlay = source.slice(source.indexOf("export function ConfirmActionOverlay"), source.indexOf("export const ConfirmActionModal"));
  assert.match(overlay, /<Modal/);
  assert.match(overlay, /presentationStyle="overFullScreen"/);
  assert.doesNotMatch(overlay, /<ConfirmActionDialog[^>]*contained/);
});

test("subscription cadence and purchase controls meet native touch target minimums", () => {
  const source = readFileSync("components/MembershipPanel.tsx", "utf8");
  assert.match(source, /cadenceButton: \{[^}]*minHeight: 44/);
  assert.match(source, /planButton: \{[^}]*minHeight: 48/);
  assert.match(source, /accessibilityState=\{\{ selected \}\}/);
});

test("billing UI uses live store pricing without blocking foreground resumes", () => {
  const membership = readFileSync("components/MembershipPanel.tsx", "utf8");
  const context = readFileSync("context/MembershipContext.tsx", "utf8");
  assert.match(membership, /product\.priceString/);
  assert.doesNotMatch(membership, /Monthly is \$9\.99|annual is \$89|\$89 per year|\$9\.99 per month/);
  assert.doesNotMatch(context, /AppState\.addEventListener\("change"/);
  assert.match(context, /const refreshPlan = useCallback/);
  assert.match(context, /if \(!FOUNDING_FREE_LAUNCH && user\?\.id && activeHousehold\.role === "owner"\)/);
});

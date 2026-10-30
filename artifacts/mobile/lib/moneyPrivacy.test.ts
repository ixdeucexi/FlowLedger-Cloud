import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { canCommitMoneyPrivacy, HIDDEN_MONEY, maskMoneyText, moneyTextSegments, moneyPrivacyAccessibility, moneyPrivacyPreference, moneyPrivacyScope, privateAlertText, readSettledMoneyPrivacy, moneyPrivacySearchSensitive, moneyPrivacyHouseholdScope } from "./moneyPrivacy";
import { privateTextChildren } from "./moneyPrivacyChildren";

test("display currency runs preserve signs, whitespace, compact amounts and ordinary dates exactly", () => {
  const text = "Checking −$263,682.34.\n  Income +$4.2k; reserve USD 1234.56; debt $12M and $8B. Due 2026-10-30 at 12.5% APR.";
  const segments = moneyTextSegments(text);
  assert.equal(segments.map(segment => segment.text).join(""), text);
  assert.deepEqual(segments.filter(segment => segment.kind === "money").map(segment => segment.text), ["−$263,682.34", "+$4.2k", "USD 1234.56", "$12M", "$8B"]);
  assert.ok(segments.filter(segment => segment.kind === "text").some(segment => segment.text.includes("2026-10-30 at 12.5% APR")));
  assert.equal(moneyTextSegments("").map(segment => segment.text).join(""), "");
});

test("currency run scanning and Privacy Mode remain independent across repeated calls", () => {
  const text = "Before $12.99, 2026-10-30; after −$4.20.\n€ 1 234.50 stays recorded.";
  for (let index = 0; index < 3; index++) {
    const segments = moneyTextSegments(text);
    assert.equal(segments.map(segment => segment.text).join(""), text);
    assert.deepEqual(segments.filter(segment => segment.kind === "money").map(segment => segment.text), ["$12.99", "−$4.20", "€ 1 234.50"]);
    const rich = segments.map((segment, key) => segment.kind === "money" ? React.createElement("span", { key }, segment.text) : segment.text);
    assert.equal(privateTextChildren(rich, true), maskMoneyText(text, true));
    assert.equal(maskMoneyText(text, false), text);
  }
});

test("private display masks signed, compact, scientific and ISO currency without changing dates, counts or APR", () => {
  const values = ["$1,234.56", "−$17.20", "+$4.2k", "$1e+24", "USD 1234.56", "1234.56 USD", "£920.50", "€ 1 234.50", "$-12.00", "$12M", "AUD12.40"];
  for (const value of values) {
    assert.equal(maskMoneyText(value, true), HIDDEN_MONEY, value);
    assert.equal(maskMoneyText(value, false), value, "reveal preserves the exact original string");
  }
  assert.equal(maskMoneyText("Flow Score 95 · 12.5% APR · Oct 30, 2026 · 3 bills · $1,234.56 due", true), `Flow Score 95 · 12.5% APR · Oct 30, 2026 · 3 bills · ${HIDDEN_MONEY} due`);
  assert.equal(maskMoneyText("2026-10-30 USD 1234.56", true), `2026-10-30 ${HIDDEN_MONEY}`);
  assert.equal(maskMoneyText("($1,234.56)\n+$26.00 available", true), `(${HIDDEN_MONEY})\n${HIDDEN_MONEY} available`);
  assert.equal(maskMoneyText("October activity net flow negative 123.45 dollars. Inflows 456.78 dollars. Outflows 580.23 dollars.", true), `October activity net flow negative ${HIDDEN_MONEY}. Inflows ${HIDDEN_MONEY}. Outflows ${HIDDEN_MONEY}.`);
  assert.equal(maskMoneyText("Rent, outflow 123.45 dollars, Bill payment, Housing, Oct 30, balance 5,678.90 dollars", true), `Rent, outflow ${HIDDEN_MONEY}, Bill payment, Housing, Oct 30, balance ${HIDDEN_MONEY}`);
});

test("every ordinary app currency value is removed from presentation and exactly restored", () => {
  for (let i = -250; i <= 250; i++) {
    const amount = i * 1234.567;
    const value = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
    assert.equal(maskMoneyText(value, true), HIDDEN_MONEY);
    assert.equal(maskMoneyText(value, false), value);
  }
});

test("actual Intl currency and Activity strings in device locales conceal complete numbers", () => {
  for (const locale of ["en-US", "de-DE", "fr-FR", "hi-IN", "ar-EG", "fa-IR"]) {
    for (const amount of [1234567.89, -1234567.89]) {
      const bare = Math.abs(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const values = [`$${bare}`, `${bare} dollars`, amount.toLocaleString(locale, { style: "currency", currency: "USD" })];
      for (const value of values) {
        const masked = maskMoneyText(value, true);
        assert.equal(/\p{Nd}/u.test(masked), false, `${locale}: ${JSON.stringify(value)} -> ${JSON.stringify(masked)}`);
        assert.equal(maskMoneyText(value, false), value);
      }
    }
  }
  assert.equal(maskMoneyText("2026-10-30 $1,234.56", true), `2026-10-30 ${HIDDEN_MONEY}`);
  assert.equal(maskMoneyText("2026 USD 1234.56", true), `2026 ${HIDDEN_MONEY}`);
  assert.equal(maskMoneyText("Match pending bill Phone, $12.99, 2026-10-30", true), `Match pending bill Phone, ${HIDDEN_MONEY}, 2026-10-30`);
  assert.equal(maskMoneyText("$1,234.56, 4 payments on 2026-10-30", true), `${HIDDEN_MONEY}, 4 payments on 2026-10-30`);
});

test("adjacent JSX currency fragments and nested styled text do not leak numeric children", () => {
  assert.deepEqual(privateTextChildren(["$", 1234.56, " paid"], true), [`${HIDDEN_MONEY} paid`]);
  const rich = ["Balance ", React.createElement("span", null, "$"), React.createElement("strong", null, "1,234.56"), " on Oct 30"];
  assert.equal(privateTextChildren(rich, true), `Balance ${HIDDEN_MONEY} on Oct 30`);
  const fragment = React.createElement(React.Fragment, null, "$", 1234.56);
  assert.equal(privateTextChildren(fragment, true), HIDDEN_MONEY);
  assert.equal(privateTextChildren(rich, false), rich);
  assert.equal(privateTextChildren("1234.56", true, true), HIDDEN_MONEY, "explicit bare monetary fields are protected");
  assert.deepEqual(privateTextChildren(["95", "%"], true), ["95%"]);
});

test("screen reader and tooltip values are masked without mutating underlying control props", () => {
  const value = Object.freeze({ now: 1234, min: 0, max: 5000, text: "$1,234 available" });
  const props = Object.freeze({ accessibilityLabel: "Checking balance $1,234 on October 30", accessibilityHint: "Spend $50", "aria-label": "$1,234 current", title: "+$50", accessibilityValue: value, "aria-valuenow": 1234 });
  const next = moneyPrivacyAccessibility(props, true, true);
  assert.equal(next.accessibilityLabel, `Checking balance ${HIDDEN_MONEY} on October 30`);
  assert.equal(next.accessibilityHint, `Spend ${HIDDEN_MONEY}`);
  assert.equal(next["aria-label"], `${HIDDEN_MONEY} current`);
  assert.equal(next.title, HIDDEN_MONEY);
  assert.deepEqual(next.accessibilityValue, { text: "Amount hidden" });
  assert.equal("aria-valuenow" in next, false);
  assert.equal(props.accessibilityValue.now, 1234);
  assert.equal(moneyPrivacyAccessibility(props, false), props);
});

test("only a saved boolean enables privacy; preference scopes cannot collide", () => {
  assert.equal(moneyPrivacyPreference(true), true);
  for (const value of [false, undefined, null, "true", 1, {}, []]) assert.equal(moneyPrivacyPreference(value), false);
  assert.notEqual(moneyPrivacyScope("a:b", "c"), moneyPrivacyScope("a", "b:c"));
  assert.equal(moneyPrivacyScope(null, "household"), null);
  assert.equal(moneyPrivacyScope("user", null), null);
});

test("late hydration and save callbacks cannot overwrite a new choice, new household or ABA return", () => {
  const a = moneyPrivacyScope("user", "a")!;
  const b = moneyPrivacyScope("user", "b")!;
  const request = Object.freeze({ scope: a, revision: 5 });
  assert.equal(canCommitMoneyPrivacy(request, { scope: a, revision: 5 }), true);
  assert.equal(canCommitMoneyPrivacy(request, { scope: a, revision: 6 }), false, "a newer toggle wins");
  assert.equal(canCommitMoneyPrivacy(request, { scope: b, revision: 6 }), false);
  assert.equal(canCommitMoneyPrivacy(request, { scope: a, revision: 7 }), false, "returning to the same household cannot accept stale responses");
  assert.equal(canCommitMoneyPrivacy(request, { scope: null, revision: 8 }), false);
});

test("retained asynchronous alert callbacks use privacy at invocation and conceal unlabelled service amounts", () => {
  let hidden = false;
  const mask = (text: string) => maskMoneyText(text, hidden);
  const show = (text: string) => privateAlertText(text, mask);
  assert.equal(show("Payment $1,234.56 saved"), "Payment $1,234.56 saved");
  hidden = true;
  assert.equal(show("Payment $1,234.56 saved"), `Payment ${HIDDEN_MONEY} saved`);
  assert.equal(show("Amount 1234.56 is below the current minimum"), "Details hidden in Privacy Mode. Show amounts to read them.");
  assert.equal(show("Please try again."), "Please try again.");
  hidden = false;
  assert.equal(show("Amount 1234.56 is below the current minimum"), "Amount 1234.56 is below the current minimum");
});

test("returning to a household waits for its hide intent queued behind another interface write", async () => {
  let stored = false;
  let reads = 0;
  let unblock!: () => void;
  const earlierWrite = new Promise<void>(resolve => { unblock = resolve; });
  const queuedHide = earlierWrite.then(() => { stored = true; });
  const load = readSettledMoneyPrivacy(async () => { reads++; return stored; }, () => queuedHide, () => queuedHide);
  await Promise.resolve();
  assert.equal(reads, 0, "old revealed value must never be read while hide is pending");
  unblock();
  assert.equal(await load, true);
  assert.equal(reads, 1);
});

test("a failed hide remains fail-closed even after the interface queue has been cleared", async () => {
  let reads = 0;
  const failed = Promise.reject(new Error("Device storage unavailable"));
  await failed.catch(() => {});
  await assert.rejects(readSettledMoneyPrivacy(async () => { reads++; return false; }, async () => {}, () => failed), /storage unavailable/);
  assert.equal(reads, 0, "a retained failed intent cannot hydrate the old revealed record");
});

test("amount-capable search conceals numeric drafts without changing the query or clear date inputs", () => {
  for (const query of ["123.45", "$1,234", "Rent 123.45", "-45.67"]) assert.equal(moneyPrivacySearchSensitive(query), true);
  for (const query of ["", "Groceries", "2026-10-30"]) assert.equal(moneyPrivacySearchSensitive(query), false);
});

test("a settled legacy personal plan can toggle privacy; loading, errors and signout cannot reuse it", () => {
  const legacy = { userId: "user-a", householdId: null, loading: false, loadError: null };
  assert.equal(moneyPrivacyHouseholdScope(legacy), "personal-user-a");
  assert.equal(moneyPrivacyHouseholdScope({ ...legacy, loading: true }), null);
  assert.equal(moneyPrivacyHouseholdScope({ ...legacy, loadError: "Plan failed" }), null);
  assert.equal(moneyPrivacyHouseholdScope({ ...legacy, userId: null }), null);
  assert.equal(moneyPrivacyHouseholdScope({ ...legacy, userId: "user-b" }), "personal-user-b");
  assert.equal(moneyPrivacyHouseholdScope({ ...legacy, householdId: "household-a", loading: true }), "household-a", "ordinary refresh keeps the verified household's preference scope");
  const oldRequest = { scope: moneyPrivacyScope("user-a", "personal-user-a")!, revision: 3 };
  assert.equal(canCommitMoneyPrivacy(oldRequest, { scope: moneyPrivacyScope("user-a", "household-a"), revision: 4 }), false);
});

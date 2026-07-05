import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOnboardingPreferences } from "./onboarding";
import { buildSetupPersonalization, determineUserFocus } from "./onboardingPersonalization";

test("setup personalization prioritizes debt payoff when selected", () => {
  const preferences = normalizeOnboardingPreferences({
    help: ["pay_off_debt", "grow_savings"],
    goals: ["grow_savings"],
  });
  const personalization = buildSetupPersonalization(preferences);
  assert.equal(determineUserFocus(preferences), "debt");
  assert.equal(personalization.nextRoute, "/(tabs)/bills");
  assert.ok(personalization.recommendedAlgorithms.includes("debtPayoff"));
  assert.ok(personalization.quickPrompts.some(prompt => /snowball/i.test(prompt)));
});

test("setup personalization routes savings users to Flo savings decisions", () => {
  const personalization = buildSetupPersonalization(normalizeOnboardingPreferences({
    goals: ["grow_savings"],
    savingsGoal: "emergency_fund",
  }));
  assert.equal(personalization.focus, "savings");
  assert.equal(personalization.nextRoute, "/(tabs)/flo");
  assert.ok(personalization.recommendedAlgorithms.includes("extraMoneyRouter"));
});

test("setup personalization uses full setup when no answers exist", () => {
  const personalization = buildSetupPersonalization(normalizeOnboardingPreferences({}));
  assert.equal(personalization.focus, "full");
  assert.equal(personalization.nextRoute, "/setup");
  assert.match(personalization.summary, /core forecast/i);
});


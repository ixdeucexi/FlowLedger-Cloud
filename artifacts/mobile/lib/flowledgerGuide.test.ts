import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { ALGORITHM_GUIDE, FLOWLEDGER_MONEY_RULES, FLOW_GUIDE_SECTIONS, STABILITY_PATH_GUIDE, buildFlowGuideRouteParams, flowGuideSectionIndex } from "./flowledgerGuide";

test("stability guide follows the calculation stages in order", () => {
  assert.deepEqual(
    STABILITY_PATH_GUIDE.map(step => step.id),
    ["stabilize", "next_paycheck", "breathing_room", "reserve", "momentum", "freedom", "standing"],
  );
  assert.match(STABILITY_PATH_GUIDE.at(-1)?.range ?? "", /180 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /7-29 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /30-59 protected days/);
  assert.match(STABILITY_PATH_GUIDE.map(step => step.range).join(" "), /60-179 protected days/);
});

test("the responsive walkthrough exposes each requested section in order", () => {
  assert.deepEqual(FLOW_GUIDE_SECTIONS.map(section => section.id), [
    "overview", "flow-score", "protected-days", "stability", "backup", "algorithms", "faq",
  ]);
  assert.equal(flowGuideSectionIndex("stability"), 3);
  assert.equal(flowGuideSectionIndex("path"), 3);
  assert.equal(flowGuideSectionIndex("unknown"), 0);
  assert.equal(FLOW_GUIDE_SECTIONS.find(section => section.id === "algorithms")?.title, "How calculations work");
  assert.equal(FLOW_GUIDE_SECTIONS.find(section => section.id === "faq")?.title, "FAQs");
});

test("both dashboards use the shared guide route contract", () => {
  const input = {
    section: "stability" as const,
    stage: "momentum" as const,
    stageLabel: "Build your backup",
    protectedDays: 45,
    protectedAmount: 4_500,
    reserveTarget: 3_000,
    backupTarget: 18_000,
    safeUntilPayday: true,
    nextPaycheckLabel: "Aug 14",
    nextAction: "Keep the next safe dollars as backup.",
    nextMilestone: "60 protected days",
    nextMilestoneAmount: 1_500,
    lowestBalance: 5_000,
    safetyFloor: 500,
    confidence: "High",
    flowScore: 82,
    flowScoreLabel: "Strong",
  };
  const params = buildFlowGuideRouteParams(input);

  assert.deepEqual(params, {
    section: "stability",
    stage: "momentum",
    stageLabel: "Build your backup",
    protectedDays: "45",
    protectedAmount: "4500",
    reserveTarget: "3000",
    backupTarget: "18000",
    safeUntilPayday: "true",
    nextPaycheckLabel: "Aug 14",
    nextAction: "Keep the next safe dollars as backup.",
    nextMilestone: "60 protected days",
    nextMilestoneAmount: "1500",
    lowestBalance: "5000",
    safetyFloor: "500",
    confidence: "High",
    flowScore: "82",
    flowScoreLabel: "Strong",
  });

  for (const path of ["app/(tabs)/index.tsx", "components/desktop/DesktopDashboard.tsx"]) {
    assert.match(readFileSync(path, "utf8"), /buildFlowGuideRouteParams\(\{/);
  }
});

test("the guide does not fabricate live facts when route data is absent", () => {
  const source = readFileSync("app/(tabs)/how-flowledger-works.tsx", "utf8");
  assert.match(source, /readGuideFacts/);
  assert.match(source, /Live guidance appears when your plan is ready/);
  assert.doesNotMatch(source, /param\(params\.stage, "next_paycheck"\)/);
  assert.doesNotMatch(source, /amount\(params\.protectedDays\).*\?\?.*0/);
});

test("guide step glyphs use theme-aware foreground colors", () => {
  const source = readFileSync("app/(tabs)/how-flowledger-works.tsx", "utf8");
  assert.match(source, /index <= sectionIndex \? c\.primaryForeground : c\.foreground/);
  assert.match(source, /active \? c\.primaryForeground : c\.foreground/);
  assert.match(source, /c\.isDark \? c\.successForeground : c\.foreground/);
  assert.doesNotMatch(source, /(?:navNumberText|pathNumber): \{ color: "#fff"/);
  assert.doesNotMatch(source, /name="check" size=\{11\} color="#fff"/);
});

test("the guide explains core money rules without unrelated product messaging", () => {
  const copy = [
    ...STABILITY_PATH_GUIDE.flatMap(step => [step.title, step.range, step.description]),
    ...ALGORITHM_GUIDE.flatMap(item => [item.title, item.description]),
    ...FLOWLEDGER_MONEY_RULES,
  ].join(" ");
  assert.match(copy, /Savings stays separate/);
  assert.match(copy, /Pending bank activity/);
  assert.doesNotMatch(copy, /Flowmentum/i);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSettingsRestoreGuard, requestedSettingsSection, restoreSavedSettingsSection } from "./settingsNavigation";

type Section = "overview" | "household" | "money";
const isSection = (value: unknown): value is Section => ["overview", "household", "money"].includes(String(value));

test("explicit empty section means overview, while only absence allows saved restoration", () => {
  assert.equal(requestedSettingsSection("", undefined, "?section=household"), "overview");
  assert.equal(requestedSettingsSection([""], "money"), "overview");
  assert.equal(requestedSettingsSection("household", "money"), "household");
  assert.equal(requestedSettingsSection(undefined, "money", "?section=household"), "money");
  assert.equal(requestedSettingsSection(undefined, undefined, "?section="), "overview");
  assert.equal(requestedSettingsSection(undefined, undefined, "?section=household"), "household");
  assert.equal(requestedSettingsSection(undefined, undefined, "?other=value"), undefined);
  assert.equal(requestedSettingsSection(undefined, undefined), undefined);
});

test("absent-route preference restoration handles valid, invalid, and rejected reads", async () => {
  const applied: Section[] = [];
  const restore = (read: () => Promise<{ settingsSection?: string }>) => restoreSavedSettingsSection({
    read, isCurrent: () => true, isSection, apply: section => applied.push(section), overview: "overview",
  });
  await restore(async () => ({ settingsSection: "household" }));
  await restore(async () => ({ settingsSection: "unknown" }));
  await restore(async () => { throw new Error("storage unavailable"); });
  assert.deepEqual(applied, ["household", "overview", "overview"]);
});

for (const newerEvent of ["Back", "new section", "scope switch", "route change", "unmount"] as const) {
  test(`late saved household cannot override ${newerEvent}`, async () => {
    const guard = createSettingsRestoreGuard();
    const generation = guard.begin();
    let active = true;
    let currentRequest = "user-a:household-a:absent";
    const capturedRequest = currentRequest;
    let finish!: (value: { settingsSection?: string }) => void;
    const pending = new Promise<{ settingsSection?: string }>(resolve => { finish = resolve; });
    const applied: Section[] = [];
    const restoring = restoreSavedSettingsSection({
      read: () => pending,
      isCurrent: () => active && guard.isCurrent(generation) && currentRequest === capturedRequest,
      isSection, apply: section => applied.push(section), overview: "overview",
    });
    if (newerEvent === "Back" || newerEvent === "new section") guard.invalidate();
    if (newerEvent === "scope switch") currentRequest = "user-b:household-b:absent";
    if (newerEvent === "route change") currentRequest = "user-a:household-a:money";
    if (newerEvent === "unmount") active = false;
    finish({ settingsSection: "household" });
    await restoring;
    assert.deepEqual(applied, []);
  });
}

test("More screen wires explicit overview and invalidates restoration before router navigation", () => {
  const source = readFileSync("app/(tabs)/more.tsx", "utf8");
  const open = source.slice(source.indexOf("const openSettingsSection ="), source.indexOf("useBackDismiss(activeSettingsSection"));
  assert.ok(open.indexOf("settingsRestoreGuard.invalidate()") < open.indexOf("setActiveSettingsSection(sectionId)"));
  assert.match(open, /sectionId === "overview" \? "" : sectionId/);
  assert.match(source, /if \(requestedSection !== undefined\)[\s\S]*?setActiveSettingsSection\(isSettingsSectionId\(requestedSection\) \? requestedSection : "overview"\);\s*return;/);
  assert.match(source, /settingsRequestKeyRef.current === settingsRequestKey/);
  assert.match(source, /return \(\) => \{ active = false; \}/);
});

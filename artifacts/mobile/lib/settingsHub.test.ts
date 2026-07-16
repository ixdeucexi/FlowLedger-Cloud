import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  attentionCountStatus,
  formatCountStatus,
  settingsGroupById,
  settingsGroupForSection,
  settingsSectionById,
} from "./settingsHub";

test("settings hub places every destination in exactly one group", () => {
  const groupedIds = SETTINGS_GROUPS.flatMap(group => group.sectionIds);
  const sectionIds = SETTINGS_SECTIONS.map(section => section.id);

  assert.equal(new Set(groupedIds).size, groupedIds.length);
  assert.deepEqual([...groupedIds].sort(), [...sectionIds].sort());
});

test("settings hub preserves the intended group order", () => {
  assert.deepEqual(SETTINGS_GROUPS.map(group => group.sectionIds), [
    ["accounts", "plaid", "money", "goals", "children"],
    ["review", "subscriptions", "reports", "algorithms"],
    ["setup", "notifications", "appearance", "backup"],
    ["membership", "security", "help", "legal"],
  ]);
  assert.equal(settingsSectionById("setup").label, "Flo setup");
});

test("count statuses handle zero, singular, and larger values", () => {
  assert.equal(formatCountStatus(0, "account"), "0 accounts");
  assert.equal(formatCountStatus(1, "account"), "1 account");
  assert.equal(formatCountStatus(12, "account"), "12 accounts");
});

test("attention statuses only highlight positive counts", () => {
  assert.deepEqual(attentionCountStatus(0, "Clear", "to review", "to review"), { label: "Clear" });
  assert.deepEqual(attentionCountStatus(1, "Clear", "to review", "to review"), { label: "1 to review", tone: "attention" });
  assert.deepEqual(attentionCountStatus(8, "Clear", "to review", "to review"), { label: "8 to review", tone: "attention" });
});

test("settings group lookups preserve the destination hierarchy", () => {
  assert.equal(settingsGroupById("money").label, "Manage your money");
  assert.equal(settingsGroupForSection("accounts").id, "money");
  assert.equal(settingsGroupForSection("appearance").id, "preferences");
  assert.equal(settingsGroupForSection("legal").id, "account");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { type AppFeedbackRow } from "./feedback";
import { UPDATE_CENTER_SCREEN, updateRequestHistory } from "./updateCenter";
import { settingsGroupForSection, visibleSettingsGroups } from "./settingsHub";

test("request history excludes other authors and ordinary feedback while retaining statuses", () => {
  const row = (id: string, user_id: string, screen: string, status = "new", created_at = "2026-10-05") => ({ id, user_id, screen, status, created_at }) as AppFeedbackRow;
  assert.deepEqual(updateRequestHistory([
    row("old", "owner", UPDATE_CENTER_SCREEN, "fixed", "2026-10-01"),
    row("other", "other", UPDATE_CENTER_SCREEN),
    row("feedback", "owner", "Settings / Help & Feedback"),
    row("new", "owner", UPDATE_CENTER_SCREEN),
  ], "owner").map(item => item.id), ["new", "old"]);
});
test("Update Center entry is in the admin-only settings group on mobile and desktop", () => {
  assert.equal(settingsGroupForSection("updates").id, "admin");
  assert.equal(visibleSettingsGroups(false).some(group => group.sectionIds.includes("updates")), false);
  const mobile = readFileSync("app/(tabs)/more.tsx", "utf8");
  assert.match(mobile, /activeSettingsSection === "updates" && feedbackAdmin/);
  const desktop = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");
  assert.match(desktop, /item.label !== "Update Center"\) \|\| isAdmin/);
  assert.match(desktop, /section === "Update Center" && isAdmin/);
});
test("request editor only clears after successful save and protects identity changes", () => {
  const component = readFileSync("components/settings/UpdateCenter.tsx", "utf8");
  assert.match(component, /await submitFeedback[\s\S]*currentIdentity.current === requestedIdentity[\s\S]*setMessage\(""\)/);
  const catchBlock = component.slice(component.indexOf("} catch (error)"), component.indexOf("} finally { sending"));
  assert.doesNotMatch(catchBlock, /setMessage/);
  assert.match(component, /sending.current\) return/);
  assert.match(component, /\.eq\("user_id", user.id\)\.eq\("screen", UPDATE_CENTER_SCREEN\)/);
  assert.match(component, /Nothing runs automatically/);
});

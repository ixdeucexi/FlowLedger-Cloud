import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { todayWithFloSchedule } from "./todayWithFloSchedule";
import { createTodayWithFloStore } from "./todayWithFloPreferences";
test("daily tip is not eligible before 8 AM and becomes eligible exactly at 8", () => {
  const before = todayWithFloSchedule(
    new Date("2026-09-12T12:59:59.999Z"),
    "America/Chicago",
  )!;
  assert.equal(before.day, "2026-09-12");
  assert.equal(before.eligible, false);
  assert.equal(before.nextMorningAt, Date.parse("2026-09-12T13:00:00Z"));
  const at = todayWithFloSchedule(
    new Date("2026-09-12T13:00:00Z"),
    "America/Chicago",
  )!;
  assert.equal(at.eligible, true);
  assert.equal(at.nextMorningAt, Date.parse("2026-09-13T13:00:00Z"));
});
test("household timezone governs day and hour, not device or UTC day", () => {
  const now = new Date("2026-09-12T00:30:00Z");
  assert.deepEqual(todayWithFloSchedule(now, "Asia/Tokyo"), {
    day: "2026-09-12",
    eligible: true,
    nextMorningAt: Date.parse("2026-09-12T23:00:00Z"),
  });
  assert.equal(todayWithFloSchedule(now, "America/Chicago")!.day, "2026-09-11");
  assert.equal(
    todayWithFloSchedule(new Date("2026-09-12T02:29:59Z"), "Asia/Kolkata")!
      .eligible,
    false,
  );
  assert.equal(
    todayWithFloSchedule(new Date("2026-09-12T02:30:00Z"), "Asia/Kolkata")!
      .eligible,
    true,
  );
});
test("next morning follows spring-forward and fall-back offset changes", () => {
  assert.equal(
    todayWithFloSchedule(new Date("2026-03-07T15:00:00Z"), "America/Chicago")!
      .nextMorningAt,
    Date.parse("2026-03-08T13:00:00Z"),
  );
  assert.equal(
    todayWithFloSchedule(new Date("2026-10-31T14:00:00Z"), "America/Chicago")!
      .nextMorningAt,
    Date.parse("2026-11-01T14:00:00Z"),
  );
});
test("invalid dates and timezone fail closed", () => {
  assert.equal(todayWithFloSchedule(new Date("bad"), "UTC"), null);
  assert.equal(todayWithFloSchedule(new Date(), "not-a-timezone"), null);
});
test("8 AM timer and foreground opportunities share one household-day claim", async () => {
  const store = createTodayWithFloStore(
    async () => ({}),
    async () => {},
  );
  await store.hydrate();
  const day = todayWithFloSchedule(
    new Date("2026-09-12T13:00:00Z"),
    "America/Chicago",
  )!.day;
  assert.equal(await store.claimPresentation("budget-a", day, "payday"), true);
  assert.equal(store.canPresent("budget-b", day), false);
  assert.equal(await store.claimPresentation("budget-b", day, "review"), false);
  assert.equal(store.canPresent("budget-a", "2026-09-13"), true);
  await store.setEnabled(false);
  assert.equal(store.canPresent("budget-a", "2026-09-13"), false);
});
test("UI arms a post-ready foreground timer without push registration or financial recomputation", () => {
  const source = readFileSync("components/TodayWithFlo.tsx", "utf8");
  assert.match(source, /schedule.nextMorningAt - Date.now\(\)/);
  assert.match(source, /if \(!morning\?\.eligible\) return/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.doesNotMatch(
    source,
    /scheduleNotification|register.*Push|getDailyBalances/,
  );
});

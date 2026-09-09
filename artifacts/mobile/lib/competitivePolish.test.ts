import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  localDayKey,
  millisecondsUntilLocalMidnight,
  startLocalDayClock,
} from "./localDay";
import { resolveActivityDateRange } from "./activityRange";
import { matchesBillSearch } from "./billSearch";
import { shouldStackQuickAccess } from "./settingsLayout";
import { filterCommands } from "./universalSearch";

test("Flo stays discoverable after its floating shortcut is hidden", () => {
  assert.equal(filterCommands("Ask Flo")[0]?.route, "/(tabs)/flo");
});

test("clock refreshes midnight, month/year rollover, suspended resume and cleans timers", () => {
  let now = new Date(2026, 11, 31, 23, 59, 59);
  const days: string[] = [];
  const queued = new Map<number, () => void>();
  let id = 0;
  const clock = startLocalDayClock(
    (day) => days.push(day),
    () => now,
    (cb) => {
      queued.set(++id, cb);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    (timer) => {
      queued.delete(timer as unknown as number);
    },
  );
  assert.equal(days.at(-1), "2026-12-31");
  assert.equal(queued.size, 1);
  now = new Date(2027, 0, 1, 0, 0, 1);
  queued.values().next().value!();
  assert.equal(days.at(-1), "2027-01-01");
  now = new Date(2027, 1, 4, 12);
  clock.refresh();
  assert.equal(days.at(-1), "2027-02-04");
  assert.equal(queued.size, 1);
  clock.stop();
  assert.equal(queued.size, 0);
  const count = days.length;
  clock.refresh();
  assert.equal(days.length, count);
});

test("calendar midnight respects spring and fall DST rather than assuming 24 hours", () => {
  const script = `const {millisecondsUntilLocalMidnight:f}=require(${JSON.stringify(require.resolve("./localDay"))}); process.stdout.write(JSON.stringify([f(new Date(2026,2,8)),f(new Date(2026,10,1))]));`;
  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: "America/Chicago" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [23 * 3600000, 25 * 3600000]);
  assert.equal(
    millisecondsUntilLocalMidnight(new Date(2026, 8, 9, 23, 59, 59)),
    1000,
  );
});

test("relative Activity dates change with the clock while explicit custom dates stay fixed", () => {
  const before = new Date(2026, 11, 31, 23);
  const after = new Date(2027, 0, 1, 1);
  assert.equal(localDayKey(after), "2027-01-01");
  assert.notDeepEqual(
    resolveActivityDateRange("today", before),
    resolveActivityDateRange("today", after),
  );
  assert.notDeepEqual(
    resolveActivityDateRange("this_month", before),
    resolveActivityDateRange("this_month", after),
  );
  assert.deepEqual(
    resolveActivityDateRange("custom", before, "2026-06-01", "2026-06-30"),
    resolveActivityDateRange("custom", after, "2026-06-01", "2026-06-30"),
  );
});

test("Bills search accepts partial names, categories, accents, whitespace, and clear", () => {
  const bill = { name: "Café Electric", category: "Utilities" };
  for (const query of [
    "",
    "  ",
    "CAFE",
    "util",
    "electric utilities",
    "  cafe  util ",
  ])
    assert.equal(matchesBillSearch(bill, query), true, query);
  assert.equal(matchesBillSearch(bill, "Rent"), false);
  assert.equal(matchesBillSearch(bill, "cafe rent"), false);
});

test("Settings keeps three squares at normal phone sizes and reflows large accessibility fonts", () => {
  for (const width of [320, 360, 390, 412])
    assert.equal(shouldStackQuickAccess(width, 1), false);
  for (const width of [320, 360, 390, 412])
    assert.equal(shouldStackQuickAccess(width, 1.5), true);
  assert.equal(shouldStackQuickAccess(280, 1), true);
  assert.equal(shouldStackQuickAccess(1024, 2), false);
});

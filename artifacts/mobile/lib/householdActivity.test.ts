import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  householdActivityHeadline,
  summarizeHouseholdActivity,
  type HouseholdActivity,
} from "./householdActivity";

function row(overrides: Partial<HouseholdActivity> = {}): HouseholdActivity {
  return {
    id: "activity-1",
    householdId: "household-1",
    actorUserId: "user-1",
    actorName: "Mike Davis",
    actorVerified: false,
    action: "updated",
    entityType: "bills",
    entityId: "bill-1",
    entityLabel: "Juice bill",
    createdAt: "2026-07-06T18:05:00.000Z",
    ...overrides,
  };
}

test("recent activity collapses create/update noise for one item on one day", () => {
  const summary = summarizeHouseholdActivity([
    row({ id: "updated", createdAt: "2026-07-06T18:05:00.000Z" }),
    row({
      id: "created",
      action: "created",
      createdAt: "2026-07-06T18:04:00.000Z",
    }),
    row({ id: "duplicate", createdAt: "2026-07-06T18:03:00.000Z" }),
  ]);

  assert.deepEqual(
    summary.map((item) => item.id),
    ["updated"],
  );
});

test("recent activity preserves different actors and different days", () => {
  const summary = summarizeHouseholdActivity([
    row({ id: "today-user-1" }),
    row({ id: "today-user-2", actorUserId: "user-2", actorName: "Jordan" }),
    row({ id: "tomorrow-user-1", createdAt: "2026-07-07T18:05:00.000Z" }),
  ]);

  assert.deepEqual(
    summary.map((item) => item.id),
    ["tomorrow-user-1", "today-user-1", "today-user-2"],
  );
});

test("duplicate invite events are summarized without erasing later-day history", () => {
  const summary = summarizeHouseholdActivity([
    row({
      id: "invite-2",
      action: "invited",
      entityId: null,
      entityType: "household_invites",
      entityLabel: "viewer",
      createdAt: "2026-07-06T18:06:00.000Z",
    }),
    row({
      id: "invite-1",
      action: "invited",
      entityId: null,
      entityType: "household_invites",
      entityLabel: "viewer",
      createdAt: "2026-07-06T18:05:00.000Z",
    }),
    row({
      id: "invite-next-day",
      action: "invited",
      entityId: null,
      entityType: "household_invites",
      entityLabel: "viewer",
      createdAt: "2026-07-07T18:05:00.000Z",
    }),
  ]);

  assert.deepEqual(
    summary.map((item) => item.id),
    ["invite-next-day", "invite-2"],
  );
});

test("legacy unverified actors are not blamed for background updates", () => {
  assert.equal(householdActivityHeadline(row()), "Juice bill was updated");
  assert.equal(
    householdActivityHeadline(row({ actorVerified: true })),
    "Mike Davis updated Juice bill",
  );
});

test("household exits name the verified actor and removed member clearly", () => {
  assert.equal(
    householdActivityHeadline(
      row({ action: "left", actorVerified: true, entityLabel: null }),
    ),
    "Mike Davis left the household",
  );
  assert.equal(
    householdActivityHeadline(
      row({
        action: "removed",
        actorVerified: true,
        entityLabel: "Jordan Lee",
      }),
    ),
    "Mike Davis removed Jordan Lee from the household",
  );
});

test("database trigger never falls back to a row owner for audit attribution", () => {
  const migration = readFileSync(
    "../../supabase/migrations/20260814061235_fix_household_activity_attribution_and_duplicates.sql",
    "utf8",
  );
  assert.match(migration, /actor_id := auth\.uid\(\)/);
  assert.match(migration, /if actor_id is null then/);
  assert.doesNotMatch(
    migration,
    /coalesce\(auth\.uid\(\), nullif\(source_row->>'user_id'/,
  );
  assert.match(migration, /actor_verified/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  type HouseholdRole,
  canEditHouseholdPlan,
  canManageHouseholdMembers,
  canRemoveHouseholdMember,
  householdAssignableRolesFor,
  householdInviteRolesFor,
  householdRoleLabel,
  normalizeHouseholdRole,
  sortHouseholdRoles,
} from "./householdPermissions";

test("household role labels stay user-friendly", () => {
  assert.equal(householdRoleLabel("owner"), "Owner");
  assert.equal(householdRoleLabel("manager"), "Manager");
  assert.equal(householdRoleLabel("editor"), "Can edit");
  assert.equal(householdRoleLabel("viewer"), "View only");
  assert.equal(householdRoleLabel(null), "Private");
});

test("unknown household roles normalize to view only", () => {
  assert.equal(normalizeHouseholdRole("manager"), "manager");
  assert.equal(normalizeHouseholdRole("anything"), "viewer");
  assert.equal(normalizeHouseholdRole(null), "viewer");
});

test("owners and managers can invite the right roles", () => {
  assert.deepEqual(householdInviteRolesFor("owner"), ["manager", "editor", "viewer"]);
  assert.deepEqual(householdInviteRolesFor("manager"), ["editor", "viewer"]);
  assert.deepEqual(householdInviteRolesFor("editor"), []);
  assert.deepEqual(householdInviteRolesFor("viewer"), []);
});

test("viewers cannot edit the shared household plan", () => {
  assert.equal(canEditHouseholdPlan(undefined), true);
  assert.equal(canEditHouseholdPlan("owner"), true);
  assert.equal(canEditHouseholdPlan("manager"), true);
  assert.equal(canEditHouseholdPlan("editor"), true);
  assert.equal(canEditHouseholdPlan("viewer"), false);
});

test("only owners and managers can manage household members", () => {
  assert.equal(canManageHouseholdMembers("owner"), true);
  assert.equal(canManageHouseholdMembers("manager"), true);
  assert.equal(canManageHouseholdMembers("editor"), false);
  assert.equal(canManageHouseholdMembers("viewer"), false);
});

test("member removal protects owners, managers, and the current user", () => {
  assert.equal(canRemoveHouseholdMember("owner", "manager"), true);
  assert.equal(canRemoveHouseholdMember("owner", "editor"), true);
  assert.equal(canRemoveHouseholdMember("manager", "editor"), true);
  assert.equal(canRemoveHouseholdMember("manager", "viewer"), true);
  assert.equal(canRemoveHouseholdMember("manager", "manager"), false);
  assert.equal(canRemoveHouseholdMember("owner", "owner"), false);
  assert.equal(canRemoveHouseholdMember("owner", "editor", true), false);
  assert.equal(canRemoveHouseholdMember("editor", "viewer"), false);
});

test("assignable member roles respect manager limits", () => {
  assert.deepEqual(householdAssignableRolesFor("owner", "editor"), ["manager", "viewer"]);
  assert.deepEqual(householdAssignableRolesFor("owner", "viewer"), ["manager", "editor"]);
  assert.deepEqual(householdAssignableRolesFor("manager", "editor"), ["viewer"]);
  assert.deepEqual(householdAssignableRolesFor("manager", "viewer"), ["editor"]);
  assert.deepEqual(householdAssignableRolesFor("manager", "manager"), []);
  assert.deepEqual(householdAssignableRolesFor("editor", "viewer"), []);
  assert.deepEqual(householdAssignableRolesFor("owner", "editor", true), []);
});

test("household roles sort from highest to lowest access", () => {
  const roles: HouseholdRole[] = ["viewer", "owner", "editor", "manager"];
  assert.deepEqual(roles.sort(sortHouseholdRoles), [
    "owner",
    "manager",
    "editor",
    "viewer",
  ]);
});

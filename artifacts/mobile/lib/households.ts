import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type HouseholdInviteRole,
  type HouseholdRole,
  normalizeHouseholdRole,
} from "@/lib/householdPermissions";
import { supabase } from "@/lib/supabase";

export type { HouseholdInviteRole, HouseholdRole };

export interface HouseholdMembership {
  householdId: string;
  budgetId: string | null;
  name: string;
  isPersonal: boolean;
  role: HouseholdRole;
  createdAt?: string;
}

export interface HouseholdInvite {
  id: string;
  householdId: string;
  role: HouseholdInviteRole;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface HouseholdMember {
  userId: string;
  role: HouseholdRole;
  joinedAt?: string;
  email?: string | null;
  displayName?: string | null;
  isCurrentUser?: boolean;
}

export interface HouseholdActivity {
  id: string;
  householdId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  action: "created" | "updated" | "deleted" | "joined" | "invited" | "changed_role" | "removed" | string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  createdAt: string;
}

const ACTIVE_HOUSEHOLD_KEY = "flowledger-active-household";

function storageKey(userId?: string | null) {
  return `${ACTIVE_HOUSEHOLD_KEY}-${userId ?? "local"}`;
}

function friendlyHouseholdError(message: string | undefined, fallback: string): string {
  const lower = (message ?? "").toLowerCase();
  if (lower.includes("only household owners or managers")) return "Only household owners or managers can do that.";
  if (lower.includes("only the household owner")) return "Only the household owner can do that.";
  if (lower.includes("view only") || lower.includes("viewer")) return "This household is view only for your account.";
  if (lower.includes("invalid invite role")) return "Choose Manager, Can edit, or View only, then try again.";
  if (lower.includes("invite code is required")) return "Enter an invite code first.";
  if (lower.includes("invalid or expired")) return "That invite code is invalid or expired.";
  return fallback;
}

export async function readStoredActiveHouseholdId(userId?: string | null): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export async function writeStoredActiveHouseholdId(userId: string | undefined | null, householdId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), householdId);
  } catch {}
}

export async function loadRemoteActiveHouseholdId(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("user_preferences")
    .select("active_household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return typeof data?.active_household_id === "string" ? data.active_household_id : null;
}

export async function saveActiveHouseholdId(userId: string | undefined | null, householdId: string): Promise<void> {
  await writeStoredActiveHouseholdId(userId, householdId);
  if (!userId) return;
  const { error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      active_household_id: householdId,
      updated_at: new Date().toISOString(),
    });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("active_household_id") || message.includes("schema cache") || message.includes("user_preferences")) return;
    throw new Error(`Save active household: ${error.message}`);
  }
}

export async function loadHouseholdMemberships(userId?: string | null): Promise<HouseholdMembership[]> {
  if (!userId) return [];

  const memberships = await supabase
    .from("household_members")
    .select("household_id, role, created_at")
    .eq("user_id", userId);

  if (memberships.error) {
    return [];
  }

  const householdIds = Array.from(new Set((memberships.data ?? []).map((row: any) => String(row.household_id)).filter(Boolean)));
  if (householdIds.length === 0) return [];

  const [households, budgets] = await Promise.all([
    supabase
      .from("households")
      .select("id, name, is_personal, created_by")
      .in("id", householdIds),
    supabase
      .from("budgets")
      .select("id, household_id, is_default")
      .in("household_id", householdIds),
  ]);

  if (households.error) return [];

  const householdById = new Map((households.data ?? []).map((row: any) => [String(row.id), row]));
  const budgetByHousehold = new Map(
    (budgets.data ?? [])
      .filter((row: any) => row.is_default !== false)
      .map((row: any) => [String(row.household_id), String(row.id)])
  );

  return (memberships.data ?? [])
    .map((membership: any): HouseholdMembership | null => {
      const householdId = String(membership.household_id);
      const household = householdById.get(householdId);
      if (!household) return null;
      const isPersonal = household.is_personal === true;
      const ownerName = isPersonal ? "Personal" : String(household.name ?? "Household");
      return {
        householdId,
        budgetId: budgetByHousehold.get(householdId) ?? null,
        name: ownerName,
        isPersonal,
        role: normalizeHouseholdRole(membership.role),
        createdAt: membership.created_at ? String(membership.created_at) : undefined,
      };
    })
    .filter((item): item is HouseholdMembership => Boolean(item))
    .sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
      if (a.role !== b.role) return a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0;
      return a.name.localeCompare(b.name);
    });
}

export async function loadHouseholdInvites(householdId: string): Promise<HouseholdInvite[]> {
  const { data, error } = await supabase
    .from("household_invites")
    .select("id, household_id, role, expires_at, accepted_at, revoked_at, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    householdId: String(row.household_id),
    role: (() => {
      const normalized = normalizeHouseholdRole(row.role);
      return normalized === "owner" ? "editor" : normalized;
    })(),
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function createHouseholdInviteCode(householdId: string, role: HouseholdInviteRole = "editor"): Promise<string> {
  const { data, error } = await supabase.rpc("create_household_invite", {
    p_household_id: householdId,
    p_role: role,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn't create invite code. Try again."));
  return String(data ?? "");
}

export async function acceptHouseholdInviteCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_household_invite", {
    p_code: code,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn't join that household. Try again."));
  return String(data ?? "");
}

export async function loadHouseholdMembers(householdId?: string | null): Promise<HouseholdMember[]> {
  if (!householdId) return [];

  const rpcResult = await supabase.rpc("get_household_members", { p_household_id: householdId });
  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    return rpcResult.data.map((row: any): HouseholdMember => ({
      userId: String(row.user_id),
      role: normalizeHouseholdRole(row.role),
      joinedAt: row.joined_at ? String(row.joined_at) : undefined,
      email: row.email ?? null,
      displayName: row.display_name ?? row.email ?? null,
      isCurrentUser: Boolean(row.is_current_user),
    }));
  }

  const fallback = await supabase
    .from("household_members")
    .select("user_id, role, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });

  if (fallback.error) return [];
  return (fallback.data ?? []).map((row: any): HouseholdMember => ({
    userId: String(row.user_id),
    role: normalizeHouseholdRole(row.role),
    joinedAt: row.created_at ? String(row.created_at) : undefined,
    displayName: row.user_id ? `Member ${String(row.user_id).slice(0, 6)}` : "Household member",
  }));
}

export async function loadHouseholdActivity(householdId?: string | null, limit = 12): Promise<HouseholdActivity[]> {
  if (!householdId) return [];

  const { data, error } = await supabase
    .from("household_activity")
    .select("id, household_id, actor_user_id, actor_email, actor_name, action, entity_type, entity_id, entity_label, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map((row: any): HouseholdActivity => ({
    id: String(row.id),
    householdId: String(row.household_id),
    actorUserId: row.actor_user_id ?? null,
    actorEmail: row.actor_email ?? null,
    actorName: row.actor_name ?? row.actor_email ?? null,
    action: String(row.action ?? "updated"),
    entityType: String(row.entity_type ?? "item"),
    entityId: row.entity_id ?? null,
    entityLabel: row.entity_label ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function updateHouseholdMemberRole(
  householdId: string,
  memberUserId: string,
  role: HouseholdInviteRole,
): Promise<void> {
  const { error } = await supabase.rpc("update_household_member_role", {
    p_household_id: householdId,
    p_member_user_id: memberUserId,
    p_role: role,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn't update that member. Try again."));
}

export async function removeHouseholdMember(householdId: string, memberUserId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_household_member", {
    p_household_id: householdId,
    p_member_user_id: memberUserId,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn't remove that member. Try again."));
}

import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/lib/supabase";

export type HouseholdRole = "owner" | "editor" | "viewer";

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
  role: Exclude<HouseholdRole, "owner">;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

const ACTIVE_HOUSEHOLD_KEY = "flowledger-active-household";

function storageKey(userId?: string | null) {
  return `${ACTIVE_HOUSEHOLD_KEY}-${userId ?? "local"}`;
}

function normalizeRole(role: unknown): HouseholdRole {
  return role === "viewer" || role === "editor" || role === "owner" ? role : "viewer";
}

function friendlyHouseholdError(message: string | undefined, fallback: string): string {
  const lower = (message ?? "").toLowerCase();
  if (lower.includes("only the household owner")) return "Only the household owner can create invite codes.";
  if (lower.includes("invalid invite role")) return "Choose Can edit or View only, then try again.";
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
        role: normalizeRole(membership.role),
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
    role: row.role === "viewer" ? "viewer" : "editor",
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function createHouseholdInviteCode(householdId: string, role: Exclude<HouseholdRole, "owner"> = "editor"): Promise<string> {
  const { data, error } = await supabase.rpc("create_household_invite", {
    p_household_id: householdId,
    p_role: role,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn’t create invite code. Try again."));
  return String(data ?? "");
}

export async function acceptHouseholdInviteCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_household_invite", {
    p_code: code,
  });
  if (error) throw new Error(friendlyHouseholdError(error.message, "Couldn’t join that household. Try again."));
  return String(data ?? "");
}

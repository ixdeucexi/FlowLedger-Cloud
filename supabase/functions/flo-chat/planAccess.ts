/** Flo access is resolved by scoped database RPCs; request bodies never set limits. */
export type FloAllowance = {
  period: "month" | "day";
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  canCreate: boolean;
};
export type FloPlanAccess = { householdId: string; features: string[]; flo: FloAllowance };
type RpcClient = { rpc(name: string, input: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseFloAllowance(value: unknown): FloAllowance | null {
  const v = object(value);
  if (!v || (v.period !== "day" && v.period !== "month") || !Number.isSafeInteger(v.limit) || Number(v.limit) < 1 || Number(v.limit) > 1000 || !Number.isSafeInteger(v.used) || Number(v.used) < 0 || !Number.isSafeInteger(v.remaining) || v.remaining !== Math.max(0, Number(v.limit) - Number(v.used)) || typeof v.canCreate !== "boolean" || typeof v.resetsAt !== "string" || !Number.isFinite(Date.parse(v.resetsAt))) return null;
  return { period: v.period, limit: Number(v.limit), used: Number(v.used), remaining: Number(v.remaining), resetsAt: v.resetsAt, canCreate: v.canCreate };
}

export function parseFloPlanAccess(value: unknown, householdId: string): FloPlanAccess | null {
  const v = object(value), flo = parseFloAllowance(v?.flo);
  if (!v || v.version !== 1 || v.householdId !== householdId || !Array.isArray(v.features) || !v.features.every(f => typeof f === "string") || !flo) return null;
  return { householdId, features: v.features as string[], flo };
}

export async function readFloPlanAccess(client: RpcClient, householdId: string, verifiedPreviewTier: "free" | "pro" | null): Promise<FloPlanAccess> {
  const result = await client.rpc("get_household_feature_access", { p_expected_household_id: householdId, p_preview_tier: verifiedPreviewTier });
  const access = result.error ? null : parseFloPlanAccess(result.data, householdId);
  if (!access || !access.features.includes("flo_account_chat")) throw new Error("plan_access_unavailable");
  return access;
}

export type FloReservation = { allowed: boolean; reservationId: string | null; legacyDaily: boolean; allowance: FloAllowance };
export function parseFloReservation(value: unknown, expectedId: string): FloReservation | null {
  const v = object(value), allowance = parseFloAllowance(v?.allowance);
  if (!v || typeof v.allowed !== "boolean" || typeof v.legacyDaily !== "boolean" || !allowance || (v.reservationId !== null && v.reservationId !== expectedId) || (v.allowed && !v.legacyDaily && v.reservationId !== expectedId) || (v.legacyDaily && v.reservationId !== null)) return null;
  return { allowed: v.allowed, reservationId: v.reservationId as string | null, legacyDaily: v.legacyDaily, allowance };
}

export async function reserveFloPlanRequest(server: RpcClient, userId: string, householdId: string, reservationId: string, verifiedPreviewTier: "free" | "pro" | null): Promise<FloReservation> {
  const result = await server.rpc("reserve_flo_plan_request", { p_user_id: userId, p_household_id: householdId, p_reservation_id: reservationId, p_preview_tier: verifiedPreviewTier });
  const reservation = result.error ? null : parseFloReservation(result.data, reservationId);
  if (!reservation) throw new Error("usage_limit_unavailable");
  return reservation;
}

/** Cache the attempt, not just completion: concurrent cleanup cannot refund twice. */
export function floReservationRefund(server: RpcClient, userId: string, householdId: string, reservationId: string | null) {
  let pending: Promise<void> | undefined;
  return () => {
    if (!reservationId) return Promise.resolve();
    return pending ??= Promise.resolve(server.rpc("refund_flo_plan_request", { p_user_id: userId, p_household_id: householdId, p_reservation_id: reservationId })).then(result => {
      if (result.error || result.data !== true) throw new Error("usage_refund_unavailable");
    });
  };
}

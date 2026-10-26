import { supabase } from "./supabase";
import { normalizeGoalRow, normalizeTransactionRow } from "./financialProjectionInput";

type BucketRpc = "add_bucket_purchase" | "undo_bucket_purchase" | "update_bucket_purchase" | "delete_bucket_purchase" | "replace_bucket_purchase";

export async function bucketPurchaseRpc(name: BucketRpc, args: Record<string, unknown>, expectedTransactionId: string, expectedBucketId?: string) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !data.transaction || !data.goal || data.transaction.id !== expectedTransactionId
    || (expectedBucketId && data.goal.id !== expectedBucketId)
    || data.goal.goal_type !== "planned_expense"
    || !Number.isFinite(Number(data.transaction.amount))
    || !Number.isFinite(Number(data.goal.current_amount))
    || !Number.isFinite(Number(data.goal.target_amount))) {
    throw new Error("The saved bucket purchase could not be verified. Refresh and try again.");
  }
  return { transaction: normalizeTransactionRow(data.transaction), goal: normalizeGoalRow(data.goal), retry: data.retry === true };
}

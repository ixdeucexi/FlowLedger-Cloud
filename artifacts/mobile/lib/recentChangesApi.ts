import { supabase } from "./supabase";
import { parseRecentChangesPage, recentChangesScopeKey, validRecentChangesCursor, type RecentChangesPage, type RecentChangesScope } from "./recentChanges";

export async function loadRecentChanges(scope: RecentChangesScope, cursor: string | null = null): Promise<RecentChangesPage> {
  if (!recentChangesScopeKey(scope) || cursor !== null && !validRecentChangesCursor(cursor)) throw new Error("Choose your active household and budget before viewing recent changes.");
  const { data, error } = await supabase.rpc("list_recent_changes", {
    p_expected_household_id: scope.householdId,
    p_expected_budget_id: scope.budgetId,
    p_before_id: cursor,
    p_limit: 25,
  });
  if (error) throw new Error(error.message || "Recent changes could not be loaded. Try again.");
  return parseRecentChangesPage(data, scope, 25, cursor);
}

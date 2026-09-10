import { localDay, type AnalysisSnapshot, type SourceRows } from "./analysisTypes.ts";

// Explicit columns keep bank credentials, raw bank payloads, and unrelated
// household data out of both the calculator and the model context.
export const analysisColumns: Record<string, string> = {
  household_settings: "household_id,starting_balance,starting_balance_date,calendar_start_date,safety_floor,forecast_horizon_months,payment_method,time_zone,planning_mode,zero_based_budget_enabled,debt_payoff_enabled,onboarding_completed",
  bills: "id,household_id,name,amount,category,priority,is_debt,balance,interest_rate,due_day,day_of_week,next_payment_date,start_date,end_date,is_recurring,frequency,created_at,smart_priority,include_in_snowball,snowball_minimum_boost,last_reviewed_at",
  monthly_overrides: "id,household_id,bill_id,month,year,custom_amount,planned_debt_amount,required_debt_amount,custom_due_day,paid_amount,actual_amount,paid_date",
  bill_date_moves: "id,household_id,bill_id,from_date,to_date,move_reason,created_at,updated_at",
  transactions: "id,household_id,date,amount,category,note,linked_bill_id,account_id,import_hash,transfer_group_id,debt_applied_amount,debt_applied_bill_id,source,plaid_transaction_id,plaid_account_id,merchant_name,pending,removed_at,deleted_at,match_confidence,match_reason,review_status,review_resolution,review_allocations,reviewed_at,user_edited_at,linked_income_id,linked_plan_id,linked_plan_type,matched_occurrence_date",
  accounts: "id,household_id,name,account_type,current_balance,balance_as_of,last_reconciled_at,is_active,created_at",
  plaid_accounts: "id,household_id,plaid_account_id,name,display_name,official_name,mask,persistent_account_id,account_type,account_subtype,current_balance,available_balance,credit_limit,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at,is_active,updated_at",
  plaid_transactions: "id,household_id,plaid_account_id,flowledger_transaction_id,plaid_transaction_id,transaction_date,authorized_date,amount,name,merchant_name,category,pending,removed_at,updated_at,primary_category:raw->personal_finance_category->>primary,detailed_category:raw->personal_finance_category->>detailed",
  pending_plan_matches: "id,household_id,pending_plaid_transaction_id,pending_account_id,target_type,target_id,target_name,occurrence_date,planned_amount,pending_amount,pending_transaction_date,status,posted_transaction_id,posted_plaid_transaction_id,posted_amount,created_at,updated_at",
  incomes: "id,household_id,name,amount,frequency,start_date,next_payment_date,amount_history,excluded_dates,last_reviewed_at",
  goals: "id,household_id,name,target_amount,target_date,current_amount,created_at,goal_type,closed_at,archived_at",
  extra_payments: "id,household_id,month,year,amount,allocations,payment_date,sources",
  decisions: "id,household_id,name,decision_type,scenario,result,status,calendar_date,actual_amount,completed_at,next_due_date,applied_change,created_at,updated_at",
  category_budgets: "id,household_id,category,month,year,amount,updated_at",
  household_daily_checking_closes: "household_id,balance_date,checking_balance,observed_at,account_count,source",
};

const PAGE = 1000;
export const ANALYSIS_MAX_ROWS = 20000;
/** Exact household predicate is mandatory on every page; caller supplies its
 * authenticated RLS client, never the service client used for audit logging. */
export async function readAnalysisSource(client: any, householdId: string, table: string): Promise<SourceRows> {
  const rows: Record<string, any>[] = [];
  const order = table === "household_settings" ? "household_id" : table === "household_daily_checking_closes" ? "balance_date" : "id";
  let cursor: string | null = null;
  try {
    while (rows.length <= ANALYSIS_MAX_ROWS) {
      let query = client.from(table).select(analysisColumns[table]).eq("household_id", householdId).order(order, { ascending: true }).limit(PAGE);
      if (cursor !== null) query = query.gt(order, cursor);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) return { rows: [], complete: false, reason: "source_unavailable" };
      if (data.some((r: any) => r.household_id !== householdId)) return { rows: [], complete: false, reason: "scope_mismatch" };
      if (rows.length + data.length > ANALYSIS_MAX_ROWS) return { rows, complete: false, reason: "bounded_history_limit" };
      rows.push(...data);
      if (data.length < PAGE) return { rows, complete: true };
      const next = String(data[data.length - 1][order]);
      if (next === cursor) return { rows, complete: false, reason: "unstable_pagination" };
      cursor = next;
    }
  } catch { return { rows: [], complete: false, reason: "source_unavailable" }; }
  return { rows, complete: false, reason: "bounded_history_limit" };
}

async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function loadAnalysisSnapshot(client: any, householdId: string, now: string): Promise<AnalysisSnapshot> {
  const sources = Object.fromEntries(await Promise.all(Object.keys(analysisColumns).map(async table => [table, await readAnalysisSource(client, householdId, table)])));
  let timeZone = sources.household_settings.rows[0]?.time_zone;
  try { if (!timeZone) throw new Error(); localDay(now, timeZone); } catch {
    timeZone = "UTC";
    sources.household_settings = { ...sources.household_settings, complete: false, reason: "household_timezone_missing" };
  }
  // This identifies the read content, not an atomic database revision. Repeat
  // financial reads before decision-oriented answers to detect concurrent edits.
  return { householdId, capturedAt: now, timeZone, today: localDay(now, timeZone), sources, hash: await digest(sources) };
}

export async function verifyAnalysisSnapshot(client: any, snapshot: AnalysisSnapshot, tables: string[]): Promise<boolean> {
  const second = await Promise.all(tables.map(async table => [table, await readAnalysisSource(client, snapshot.householdId, table)] as const));
  return second.every(([table, source]) => source.complete && JSON.stringify(source) === JSON.stringify(snapshot.sources[table]));
}

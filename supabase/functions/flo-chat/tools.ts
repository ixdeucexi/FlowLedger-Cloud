import { z } from "npm:zod@4.4.3";
import { tool } from "npm:ai@7.0.59";
import {
  boundedLimit,
  FLO_V3_MAX_ROWS,
  freshness,
  isDateOnly,
  money,
  safeSearchTerm,
  type FloSourceRef,
  type FloToolEnvelope,
} from "./contract.ts";

type UserClient = any;

export type FloToolRuntime = {
  client: UserClient;
  householdId: string;
  userId: string;
  now: string;
  toolResults: FloToolEnvelope[];
  toolNames: string[];
  memberRole?: string;
  proposalDraft?: {
    kind: "recurring_bill_change";
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    evidenceIds: string[];
  };
  onToolResult?: (name: string, result: FloToolEnvelope, parameters: Record<string, unknown>) => Promise<void>;
};

type QueryResult = { data: any[] | null; error: { code?: string; message?: string } | null; count?: number | null };

function iso(value: unknown): string | null {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function routeFor(type: string, recordId?: string): string | undefined {
  if (type === "transaction") return "/(tabs)/transactions";
  if (type === "debt") return recordId ? `/(tabs)/bills?debtId=${encodeURIComponent(recordId)}` : "/(tabs)/bills";
  if (type === "bill") return "/(tabs)/bills";
  if (type === "forecast" || type === "decision") return "/(tabs)/monthly";
  if (type === "goal" || type === "budget") return "/(tabs)/bills";
  if (type === "account" || type === "connection") return "/(tabs)/more";
  return undefined;
}

function buildEvidence(
  name: string,
  type: string,
  label: string,
  records: any[],
  now: string,
  startDate?: string,
  endDate?: string,
): FloSourceRef[] {
  if (!records.length) {
    return [{ id: `${name}:query`, type, label, asOf: null, freshness: "unknown", route: routeFor(type), startDate, endDate }];
  }
  return records.slice(0, 80).map(record => {
    const recordId = String(record.id ?? record.account_id ?? record.category ?? record.household_id ?? "record");
    const timestamp = record.last_successful_sync_at ?? record.liability_last_synced_at ?? record.updated_at ?? record.balance_as_of ?? record.last_reconciled_at ?? record.last_reviewed_at;
    const asOf = iso(timestamp);
    return {
      id: `${name}:${recordId}`,
      type,
      label: String(record.display_name ?? record.name ?? record.merchant_name ?? record.note ?? record.category ?? label).slice(0, 100),
      recordId,
      route: routeFor(type, recordId),
      asOf,
      freshness: asOf ? freshness(asOf) : "unknown",
      startDate,
      endDate,
    };
  });
}

function evidenceDataAsOf(evidence: FloSourceRef[]): string | null {
  const values = evidence.map(source => source.asOf ? Date.parse(source.asOf) : Number.NaN).filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

async function tracked(
  runtime: FloToolRuntime,
  name: string,
  parameters: Record<string, unknown>,
  run: () => Promise<FloToolEnvelope>,
) {
  const result = await run().catch((): FloToolEnvelope => ({
    status: "unavailable",
    dataAsOf: null,
    coverage: { complete: false, returned: 0, limit: 0, reason: "query_failed" },
    evidence: [],
    records: [],
    message: "This part of your account is temporarily unavailable.",
  }));
  runtime.toolNames.push(name);
  runtime.toolResults.push(result);
  await runtime.onToolResult?.(name, result, parameters);
  return result;
}

async function rowsEnvelope(
  runtime: FloToolRuntime,
  name: string,
  type: string,
  label: string,
  limit: number,
  execute: () => Promise<QueryResult>,
  startDate?: string,
  endDate?: string,
): Promise<FloToolEnvelope> {
  const { data, error, count } = await execute();
  if (error) {
    return {
      status: "unavailable", dataAsOf: null,
      coverage: { complete: false, returned: 0, limit, startDate, endDate, reason: error.code ?? "query_failed" },
      evidence: [], records: [], message: "This source could not be checked right now.",
    };
  }
  const records = data ?? [];
  const complete = typeof count === "number" ? count <= records.length : records.length < limit;
  const evidence = buildEvidence(name, type, label, records, runtime.now, startDate, endDate);
  const timestamps = evidence.map(source => source.asOf ? Date.parse(source.asOf) : Number.NaN).filter(Number.isFinite);
  return {
    status: complete ? "ok" : "partial",
    dataAsOf: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    coverage: { complete, returned: records.length, limit, startDate, endDate, ...(complete ? {} : { reason: "result_limit" }) },
    evidence,
    records,
  };
}

function dateRange(startDate?: string, endDate?: string) {
  if (startDate && !isDateOnly(startDate)) throw new Error("invalid_start_date");
  if (endDate && !isDateOnly(endDate)) throw new Error("invalid_end_date");
  if (startDate && endDate && startDate > endDate) throw new Error("invalid_date_range");
  return { startDate, endDate };
}

function canonicalPlaidAccounts(rows: any[], includeArchived = false) {
  const key = (account: any) => account.persistent_account_id
    ? `persistent:${account.persistent_account_id}`
    : `fallback:${account.plaid_account_id ?? account.id}:${account.account_type ?? ""}:${account.account_subtype ?? ""}:${String(account.official_name ?? account.name ?? "").toLowerCase()}`;
  const canonical = new Map<string, any>();
  rows.filter(account => includeArchived || account.is_active !== false).forEach(account => {
    const identity = key(account);
    const current = canonical.get(identity);
    if (!current || String(account.updated_at ?? "") > String(current.updated_at ?? "")) canonical.set(identity, account);
  });
  return [...canonical.values()];
}

function centsTotal(values: unknown[]) {
  const valid = values.map(money).filter((value): value is number => value !== null);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
}

export function createFloTools(runtime: FloToolRuntime) {
  return {
    getFlowLedgerHelp: tool({
      description: "Read allowlisted FlowLedger feature and navigation help. Use for questions about how the app works, where a feature lives, or what Flo can do.",
      inputSchema: z.object({ topic: z.enum(["flo", "accounts", "transactions", "bills_debt", "forecast", "simulator", "settings", "households"]) }),
      execute: async ({ topic }) => tracked(runtime, "getFlowLedgerHelp", { topic }, async () => {
        const facts: Record<string, Record<string, unknown>> = {
          flo: { id: "flo", name: "Flo", description: "Flo answers verified questions about the selected household. Pro users can review supported plan changes, but Flo never moves money or changes records without confirmation.", route: "/(tabs)/flo" },
          accounts: { id: "accounts", name: "Accounts", description: "Account connections, balances, and names are managed from More and account settings.", route: "/(tabs)/more" },
          transactions: { id: "transactions", name: "Activity", description: "Posted transactions, review status, categories, and matches are available in Activity.", route: "/(tabs)/transactions" },
          bills_debt: { id: "bills_debt", name: "Bills and debt", description: "Bills, debts, and the Debt Payoff Planner are available in Bills.", route: "/(tabs)/bills" },
          forecast: { id: "forecast", name: "Forecast", description: "The calendar forecast and projected daily balances are available in Forecast.", route: "/(tabs)/monthly" },
          simulator: { id: "simulator", name: "Plan Simulator", description: "Plan Simulator previews income and plan changes without changing the real household plan.", route: "/(tabs)/monthly?simulator=1" },
          settings: { id: "settings", name: "Settings", description: "Preferences, membership, accounts, security, and setup controls are available in More.", route: "/(tabs)/more" },
          households: { id: "households", name: "Households", description: "Flo reads only the currently selected household. Household access and roles are managed in More.", route: "/(tabs)/more" },
        };
        const record = facts[topic];
        return { status: "ok", dataAsOf: null, coverage: { complete: true, returned: 1, limit: 1 }, evidence: buildEvidence("getFlowLedgerHelp", "help", String(record.name), [record], runtime.now), records: [record] };
      }),
    }),

    getAccountOverview: tool({
      description: "Read active or archived FlowLedger accounts and balances for the active household. Use this before answering any balance or account question.",
      inputSchema: z.object({ includeArchived: z.boolean().default(false) }),
      execute: async ({ includeArchived }) => tracked(runtime, "getAccountOverview", { includeArchived }, async () => {
        const limit = 100;
        let query = runtime.client.from("accounts")
          .select("id,name,account_type,current_balance,balance_as_of,last_reconciled_at,is_active,created_at", { count: "exact" })
          .eq("household_id", runtime.householdId)
          .order("is_active", { ascending: false })
          .order("name", { ascending: true })
          .limit(limit);
        if (!includeArchived) query = query.eq("is_active", true);
        const [manual, connected] = await Promise.all([
          query,
          (() => { let connectedQuery = runtime.client.from("plaid_accounts").select("id,plaid_account_id,persistent_account_id,name,display_name,official_name,account_type,account_subtype,current_balance,available_balance,is_active,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).limit(limit); if (!includeArchived) connectedQuery = connectedQuery.eq("is_active", true); return connectedQuery; })(),
        ]);
        if (manual.error || connected.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: limit * 2, reason: manual.error?.code ?? connected.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const connectedAccounts = canonicalPlaidAccounts(connected.data ?? [], includeArchived);
        const connectedKinds = new Set(connectedAccounts.filter(account => account.account_type === "depository").map(account => String(account.account_subtype)));
        const manualAccounts = (manual.data ?? []).filter((account: any) => !connectedKinds.has(String(account.account_type)));
        const accountRecords = [...connectedAccounts.map(account => ({ ...account, source_kind: "connected" })), ...manualAccounts.map((account: any) => ({ ...account, source_kind: "manual" }))];
        const records = accountRecords;
        const checking = records.filter(account => account.account_subtype === "checking" || account.account_type === "checking");
        const savings = records.filter(account => account.account_subtype === "savings" || account.account_type === "savings");
        const liabilities = records.filter(account => account.account_type === "credit" || account.account_type === "loan");
        const liquidAssets = [...checking, ...savings];
        const missingCheckingBalances = checking.filter(account => money(account.current_balance) === null).length;
        const missingSavingsBalances = savings.filter(account => money(account.current_balance) === null).length;
        const missingLiquidBalances = missingCheckingBalances + missingSavingsBalances;
        const missingLiabilityBalances = liabilities.filter(account => money(account.current_balance) === null).length;
        const exclusions = connectedKinds.size ? ["A manual checking or savings account is excluded only when a connected account of that same type is available, preventing double-counting."] : [];
        const accountTimestamps = records.map(account => account.updated_at ?? account.balance_as_of ?? account.last_reconciled_at).filter(Boolean).map(value => Date.parse(String(value))).filter(Number.isFinite);
        const missingAccountTimestamps = records.length - accountTimestamps.length;
        const dataAsOf = accountTimestamps.length ? new Date(Math.min(...accountTimestamps)).toISOString() : null;
        const summary = { id: "summary", record_kind: "canonical_account_summary", updated_at: accountTimestamps.length ? dataAsOf : null, checkingBalance: missingCheckingBalances ? null : (centsTotal(checking.map(account => account.current_balance)) ?? 0), savingsBalance: missingSavingsBalances ? null : (centsTotal(savings.map(account => account.current_balance)) ?? 0), liquidAssets: missingLiquidBalances ? null : (centsTotal(liquidAssets.map(account => account.current_balance)) ?? 0), liabilities: missingLiabilityBalances ? null : (centsTotal(liabilities.map(account => account.current_balance)) ?? 0), accountCount: records.length, connectedAccountCount: connectedAccounts.length, missingCheckingBalances, missingSavingsBalances, missingLiquidBalances, missingLiabilityBalances, missingAccountTimestamps, exclusions };
        const exactCount = Number(manual.count ?? manual.data?.length ?? 0) + Number(connected.count ?? connected.data?.length ?? 0);
        const complete = exactCount <= Number(manual.data?.length ?? 0) + Number(connected.data?.length ?? 0);
        const evidence = buildEvidence("getAccountOverview", "account", includeArchived ? "Household accounts" : "Active household accounts", records, runtime.now);
        evidence.push(...buildEvidence("getAccountOverview", "account", "Canonical account totals", [summary], runtime.now));
        const summaryComplete = complete && missingLiquidBalances === 0 && missingLiabilityBalances === 0 && missingAccountTimestamps === 0;
        return { status: summaryComplete ? "ok" : "partial", dataAsOf, coverage: { complete: summaryComplete, returned: records.length, limit: limit * 2, reason: missingAccountTimestamps ? "account_freshness_unknown" : undefined, exclusions: [...exclusions, ...(missingLiquidBalances || missingLiabilityBalances ? ["One or more account balances are unknown; affected totals are unavailable rather than treated as zero."] : []), ...(missingAccountTimestamps ? ["One or more accounts have no reliable balance timestamp; freshness is unknown."] : [])] }, evidence, records: [...records, summary], summary };
      }),
    }),

    searchTransactions: tool({
      description: "Search actual FlowLedger transactions with exact optional dates, merchant/text, category, pending, review, and deleted filters. Amounts are signed: positive is inflow, negative is outflow.",
      inputSchema: z.object({
        startDate: z.string().nullable().default(null), endDate: z.string().nullable().default(null),
        query: z.string().nullable().default(null), category: z.string().nullable().default(null),
        pending: z.boolean().nullable().default(null), reviewStatus: z.string().nullable().default(null),
        includeDeleted: z.boolean().default(false), limit: z.number().int().min(1).max(FLO_V3_MAX_ROWS).default(100),
      }),
      execute: async input => tracked(runtime, "searchTransactions", input, async () => {
        const { startDate, endDate } = dateRange(input.startDate ?? undefined, input.endDate ?? undefined);
        const limit = boundedLimit(input.limit, 100);
        const scanLimit = FLO_V3_MAX_ROWS;
        let query = runtime.client.from("transactions")
          .select("id,date,amount,category,note,merchant_name,source,plaid_account_id,pending,review_status,review_resolution,linked_bill_id,linked_income_id,linked_plan_id,matched_occurrence_date,removed_at,deleted_at,user_edited_at,reviewed_at", { count: "exact" })
          .eq("household_id", runtime.householdId).order("date", { ascending: false }).order("id", { ascending: false }).limit(scanLimit);
        if (startDate) query = query.gte("date", startDate);
        if (endDate) query = query.lte("date", endDate);
        if (input.pending !== null) query = query.eq("pending", input.pending);
        if (input.category) query = query.eq("category", input.category.slice(0, 80));
        if (input.reviewStatus) query = query.eq("review_status", input.reviewStatus.slice(0, 40));
        if (!input.includeDeleted) query = query.is("removed_at", null).is("deleted_at", null);
        const term = safeSearchTerm(input.query);
        if (term) query = query.or(`merchant_name.ilike.%${term}%,note.ilike.%${term}%`);
        const [transactions, connected] = await Promise.all([
          query,
          runtime.client.from("plaid_accounts").select("id,plaid_account_id,account_type,account_subtype,is_active,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).limit(200),
        ]);
        if (transactions.error || connected.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit, startDate, endDate, reason: transactions.error?.code ?? connected.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const connectedKind = new Map((connected.data ?? []).flatMap((account: any) => {
          const kind = account.account_type === "depository" && account.account_subtype === "checking" ? "checking" : "non_cash";
          return [[account.id, kind], [account.plaid_account_id, kind]].filter(([id]) => Boolean(id));
        }));
        const eligibleRecords = (transactions.data ?? []).filter((row: any) => {
          if (row.source !== "plaid") return true;
          return connectedKind.get(row.plaid_account_id) === "checking";
        });
        const rawComplete = typeof transactions.count === "number" ? transactions.count <= (transactions.data?.length ?? 0) : (transactions.data?.length ?? 0) < scanLimit;
        const records = eligibleRecords.slice(0, limit);
        const excluded = (transactions.data?.length ?? 0) - eligibleRecords.length;
        const cashRecords = records.filter((row: any) => row.pending !== true && (row.source === "plaid" || row.review_status !== "transfer"));
        const inflows = cashRecords.filter((row: any) => money(row.amount) !== null && Number(row.amount) > 0);
        const outflows = cashRecords.filter((row: any) => money(row.amount) !== null && Number(row.amount) < 0);
        const connectedComplete = typeof connected.count === "number" ? connected.count <= (connected.data?.length ?? 0) : (connected.data?.length ?? 0) < 200;
        const complete = connectedComplete && rawComplete && eligibleRecords.length <= limit;
        const summary = { id: "summary", record_kind: "cash_transaction_summary", inflows: complete ? (centsTotal(inflows.map((row: any) => row.amount)) ?? 0) : null, outflows: complete ? (centsTotal(outflows.map((row: any) => Math.abs(Number(row.amount)))) ?? 0) : null, net: complete ? (centsTotal(cashRecords.map((row: any) => row.amount)) ?? 0) : null, transactionCount: complete ? cashRecords.length : null, matchedRowCount: records.length, inflowCount: complete ? inflows.length : null, outflowCount: complete ? outflows.length : null, excludedPendingOrManualTransferRows: records.length - cashRecords.length, excludedNonCashPlaidTransactions: excluded, complete };
        const evidence = buildEvidence("searchTransactions", "transaction", "Matching cash transactions", records, runtime.now, startDate, endDate);
        evidence.push(...buildEvidence("searchTransactions", "transaction", "Transaction totals", [summary], runtime.now, startDate, endDate));
        return { status: "partial", dataAsOf: null, coverage: { complete: false, returned: records.length, limit, startDate, endDate, reason: complete ? "transaction_source_freshness_unknown" : "result_limit_or_prefilter_scan_limit", exclusions: ["Totals are unavailable whenever the bounded source scan cannot prove all matching checking rows were classified.", "Transaction occurrence dates are not source-sync timestamps, so source freshness is unknown.", "Pending, manual transfer, connected credit-card, and connected savings activity is excluded from cash-flow totals. Posted Plaid checking rows remain included because they changed checking, even while awaiting review or marked as a transfer.", ...(excluded ? [`${excluded} non-cash connected transaction rows were excluded.`] : [])] }, evidence, records: [...records, summary], summary };
      }),
    }),

    getBillsAndDebt: tool({
      description: "Read canonical configured bills or debt balances for the active household. Do not derive occurrences or forecast totals from this tool alone.",
      inputSchema: z.object({ debtOnly: z.boolean().default(false), includeClosed: z.boolean().default(false), query: z.string().nullable().default(null) }),
      execute: async input => tracked(runtime, "getBillsAndDebt", input, async () => {
        const limit = FLO_V3_MAX_ROWS;
        let query = runtime.client.from("bills")
          .select("id,name,amount,category,priority,is_debt,balance,interest_rate,due_day,day_of_week,next_payment_date,start_date,end_date,is_recurring,frequency,include_in_snowball,snowball_minimum_boost,last_reviewed_at,smart_priority,created_at", { count: "exact" })
          .eq("household_id", runtime.householdId).order("is_debt", { ascending: false }).order("priority", { ascending: true }).limit(limit);
        if (input.debtOnly) query = query.eq("is_debt", true);
        if (!input.includeClosed) query = query.or("is_debt.eq.false,balance.gt.0.009");
        const term = safeSearchTerm(input.query);
        if (term) query = query.ilike("name", `%${term}%`);
        const result = await rowsEnvelope(runtime, "getBillsAndDebt", input.debtOnly ? "debt" : "bill", input.debtOnly ? "Debt accounts" : "Bills and debt", limit, () => query);
        if (result.status === "unavailable") return result;
        const debtRows = (result.records as any[]).filter(row => row.is_debt === true);
        result.summary = { id: "summary", record_kind: "configured_debt_summary", debtBalance: centsTotal(debtRows.map(row => row.balance)) ?? 0, configuredMinimums: centsTotal(debtRows.map(row => row.amount)) ?? 0, activeDebtCount: debtRows.filter(row => Number(row.balance) > 0.009).length, billRecordCount: result.records.length, occurrenceObligationsAvailable: false };
        result.records.push(result.summary);
        result.evidence.push(...buildEvidence("getBillsAndDebt", input.debtOnly ? "debt" : "bill", "Configured debt totals", [result.summary], runtime.now));
        return result;
      }),
    }),

    getBillPlanDetails: tool({
      description: "Read bill overrides, planned debt amounts, paid amounts, and occurrence date moves for an exact month. Use for why/when/how-much bill questions.",
      inputSchema: z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(0).max(11), billId: z.string().nullable().default(null) }),
      execute: async input => tracked(runtime, "getBillPlanDetails", input, async () => {
        const startDate = `${input.year}-${String(input.month + 1).padStart(2, "0")}-01`;
        const endDate = new Date(Date.UTC(input.year, input.month + 1, 0)).toISOString().slice(0, 10);
        let overridesQuery = runtime.client.from("monthly_overrides")
          .select("id,bill_id,month,year,custom_amount,planned_debt_amount,custom_due_day,paid_amount,actual_amount,paid_date", { count: "exact" })
          .eq("household_id", runtime.householdId).eq("year", input.year).eq("month", input.month).limit(FLO_V3_MAX_ROWS);
        let movesQuery = runtime.client.from("bill_date_moves")
          .select("id,bill_id,from_date,to_date,move_reason,created_at,updated_at", { count: "exact" })
          .eq("household_id", runtime.householdId).or(`and(from_date.gte.${startDate},from_date.lte.${endDate}),and(to_date.gte.${startDate},to_date.lte.${endDate})`).limit(FLO_V3_MAX_ROWS);
        if (input.billId) {
          overridesQuery = overridesQuery.eq("bill_id", input.billId);
          movesQuery = movesQuery.eq("bill_id", input.billId);
        }
        const [overrides, moves] = await Promise.all([overridesQuery, movesQuery]);
        if (overrides.error || moves.error) {
          return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: FLO_V3_MAX_ROWS, startDate, endDate, reason: overrides.error?.code ?? moves.error?.code ?? "query_failed" }, evidence: [], records: [], message: "The exact bill plan could not be checked." };
        }
        const records = [{ kind: "monthly_overrides", rows: overrides.data ?? [] }, { kind: "date_moves", rows: moves.data ?? [] }];
        const sourceRecords = [...(overrides.data ?? []), ...(moves.data ?? [])];
        const complete = (overrides.count ?? sourceRecords.length) <= (overrides.data?.length ?? 0) && (moves.count ?? sourceRecords.length) <= (moves.data?.length ?? 0);
        const evidence = buildEvidence("getBillPlanDetails", "bill", "Monthly bill plan", sourceRecords, runtime.now, startDate, endDate);
        return { status: complete ? "ok" : "partial", dataAsOf: evidenceDataAsOf(evidence), coverage: { complete, returned: sourceRecords.length, limit: FLO_V3_MAX_ROWS, startDate, endDate }, evidence, records };
      }),
    }),

    getIncomeSchedule: tool({
      description: "Read configured income schedules, amount histories, and excluded pay dates for the active household.",
      inputSchema: z.object({ query: z.string().nullable().default(null) }),
      execute: async input => tracked(runtime, "getIncomeSchedule", input, async () => {
        const limit = 100;
        let query = runtime.client.from("incomes").select("id,name,amount,frequency,start_date,next_payment_date,amount_history,excluded_dates,last_reviewed_at", { count: "exact" }).eq("household_id", runtime.householdId).order("name").limit(limit);
        const term = safeSearchTerm(input.query);
        if (term) query = query.ilike("name", `%${term}%`);
        return rowsEnvelope(runtime, "getIncomeSchedule", "income", "Income schedule", limit, () => query);
      }),
    }),

    getBudgetsAndGoals: tool({
      description: "Read category budgets and savings/planned-expense goals for an exact month when provided.",
      inputSchema: z.object({ year: z.number().int().min(2000).max(2200).nullable().default(null), month: z.number().int().min(0).max(11).nullable().default(null), includeClosed: z.boolean().default(false) }),
      execute: async input => tracked(runtime, "getBudgetsAndGoals", input, async () => {
        let budgets = runtime.client.from("category_budgets").select("id,category,month,year,amount,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).order("year", { ascending: false }).order("month", { ascending: false }).limit(FLO_V3_MAX_ROWS);
        if (input.year !== null) budgets = budgets.eq("year", input.year);
        if (input.month !== null) budgets = budgets.eq("month", input.month);
        let goals = runtime.client.from("goals").select("id,name,target_amount,current_amount,target_date,goal_type,closed_at,archived_at,created_at", { count: "exact" }).eq("household_id", runtime.householdId).limit(FLO_V3_MAX_ROWS);
        if (!input.includeClosed) goals = goals.is("closed_at", null).is("archived_at", null);
        const [budgetRows, goalRows] = await Promise.all([budgets, goals]);
        if (budgetRows.error || goalRows.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: FLO_V3_MAX_ROWS, reason: budgetRows.error?.code ?? goalRows.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const all = [...(budgetRows.data ?? []).map((row: any) => ({ ...row, id: `budget:${row.id}`, source_id: row.id, record_kind: "budget" })), ...(goalRows.data ?? []).map((row: any) => ({ ...row, id: `goal:${row.id}`, source_id: row.id, record_kind: "goal" }))];
        const complete = (budgetRows.count ?? all.length) <= (budgetRows.data?.length ?? 0) && (goalRows.count ?? all.length) <= (goalRows.data?.length ?? 0);
        const evidence = buildEvidence("getBudgetsAndGoals", "budget", "Budgets and goals", all, runtime.now);
        return { status: complete ? "ok" : "partial", dataAsOf: evidenceDataAsOf(evidence), coverage: { complete, returned: all.length, limit: FLO_V3_MAX_ROWS }, evidence, records: all };
      }),
    }),

    getDecisionsAndSimulations: tool({
      description: "Read saved/planned decisions and saved simulator definitions. Simulator results are not persisted and cannot be invented.",
      inputSchema: z.object({ status: z.string().nullable().default(null), limit: z.number().int().min(1).max(FLO_V3_MAX_ROWS).default(80) }),
      execute: async input => tracked(runtime, "getDecisionsAndSimulations", input, async () => {
        const limit = boundedLimit(input.limit, 80);
        let decisions = runtime.client.from("decisions").select("id,name,decision_type,scenario,result,status,calendar_date,actual_amount,completed_at,next_due_date,created_at,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).order("updated_at", { ascending: false }).limit(limit);
        if (input.status) decisions = decisions.eq("status", input.status.slice(0, 30));
        const simulations = runtime.client.from("plan_simulations").select("id,name,horizon_months,changes,version,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).order("updated_at", { ascending: false }).limit(limit);
        const [decisionRows, simulationRows] = await Promise.all([decisions, simulations]);
        if (decisionRows.error || simulationRows.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit, reason: decisionRows.error?.code ?? simulationRows.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const all = [...(decisionRows.data ?? []).map((row: any) => ({ ...row, id: `decision:${row.id}`, source_id: row.id, record_kind: "decision" })), ...(simulationRows.data ?? []).map((row: any) => ({ ...row, id: `simulation:${row.id}`, source_id: row.id, record_kind: "simulation" }))];
        const complete = (decisionRows.count ?? all.length) <= (decisionRows.data?.length ?? 0) && (simulationRows.count ?? all.length) <= (simulationRows.data?.length ?? 0);
        const evidence = buildEvidence("getDecisionsAndSimulations", "decision", "Decisions and simulations", all, runtime.now);
        return { status: complete ? "ok" : "partial", dataAsOf: evidenceDataAsOf(evidence), coverage: { complete, returned: all.length, limit }, evidence, records: all };
      }),
    }),

    getDebtPlanHistory: tool({
      description: "Read persisted debt snowball/avalanche extra payment plans and allocations. This does not recompute payoff projections.",
      inputSchema: z.object({ year: z.number().int().min(2000).max(2200).nullable().default(null), month: z.number().int().min(0).max(11).nullable().default(null) }),
      execute: async input => tracked(runtime, "getDebtPlanHistory", input, async () => {
        const limit = 100;
        let query = runtime.client.from("extra_payments").select("id,month,year,amount,allocations,payment_date,sources,created_at", { count: "exact" }).eq("household_id", runtime.householdId).order("year", { ascending: false }).order("month", { ascending: false }).limit(limit);
        if (input.year !== null) query = query.eq("year", input.year);
        if (input.month !== null) query = query.eq("month", input.month);
        return rowsEnvelope(runtime, "getDebtPlanHistory", "debt", "Debt payment plans", limit, () => query);
      }),
    }),

    getConnectionHealth: tool({
      description: "Read bank connection and connected account freshness for the active household. Never returns Plaid tokens or credentials.",
      inputSchema: z.object({}),
      execute: async input => tracked(runtime, "getConnectionHealth", input, async () => {
        const [items, accounts] = await Promise.all([
          runtime.client.from("plaid_items").select("id,institution_name,status,error_code,last_attempted_sync_at,last_successful_sync_at,consent_expiration_time,created_at,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).limit(50),
          runtime.client.from("plaid_accounts").select("id,name,display_name,account_type,account_subtype,current_balance,available_balance,minimum_payment_amount,next_payment_due_date,last_statement_balance,last_statement_issue_date,is_overdue,purchase_apr,liability_last_synced_at,is_active,updated_at", { count: "exact" }).eq("household_id", runtime.householdId).limit(100),
        ]);
        if (items.error || accounts.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: 150, reason: items.error?.code ?? accounts.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const all = [...(items.data ?? []).map((row: any) => ({ ...row, id: `connection:${row.id}`, source_id: row.id, record_kind: "connection" })), ...(accounts.data ?? []).map((row: any) => ({ ...row, id: `connected_account:${row.id}`, source_id: row.id, record_kind: "connected_account" }))];
        const complete = (items.count ?? all.length) <= (items.data?.length ?? 0) && (accounts.count ?? all.length) <= (accounts.data?.length ?? 0);
        const evidence = buildEvidence("getConnectionHealth", "connection", "Bank connection health", all, runtime.now);
        return { status: complete ? "ok" : "partial", dataAsOf: evidenceDataAsOf(evidence), coverage: { complete, returned: all.length, limit: 150 }, evidence, records: all };
      }),
    }),

    getHouseholdAndSettings: tool({
      description: "Read the current member's role, household settings, and Flo memory opt-in state for this exact active household.",
      inputSchema: z.object({}),
      execute: async input => tracked(runtime, "getHouseholdAndSettings", input, async () => {
        const [member, settings, memory] = await Promise.all([
          runtime.client.from("household_members").select("household_id,user_id,role,created_at").eq("household_id", runtime.householdId).eq("user_id", runtime.userId).maybeSingle(),
          runtime.client.from("household_settings").select("household_id,payment_method,safety_floor,forecast_horizon_months,onboarding_completed,planning_mode,updated_at").eq("household_id", runtime.householdId).maybeSingle(),
          runtime.client.from("flo_household_memory").select("enabled,preferences,updated_at").eq("household_id", runtime.householdId).eq("user_id", runtime.userId).maybeSingle(),
        ]);
        if (member.error || settings.error || memory.error) return { status: "unavailable", dataAsOf: null, coverage: { complete: false, returned: 0, limit: 3, reason: member.error?.code ?? settings.error?.code ?? memory.error?.code ?? "query_failed" }, evidence: [], records: [] };
        const records = [{ id: "membership", kind: "membership", ...member.data }, { id: "settings", kind: "settings", ...settings.data }, { id: "flo_memory", kind: "flo_memory", enabled: memory.data?.enabled === true, preferences: memory.data?.enabled ? memory.data.preferences : {}, updated_at: memory.data?.updated_at }];
        const evidence = buildEvidence("getHouseholdAndSettings", "household", "Active household settings", records, runtime.now);
        return { status: "ok", dataAsOf: evidenceDataAsOf(evidence), coverage: { complete: true, returned: records.length, limit: 3 }, evidence, records };
      }),
    }),

    draftRecurringBillChange: tool({
      description: "Create a review-only draft for changing a recurring bill amount. Call only after getBillsAndDebt returned the exact bill and the user explicitly requested a new amount. This does not change the plan.",
      inputSchema: z.object({ billId: z.string().min(1).max(120), newAmount: z.number().positive().max(1_000_000), evidenceId: z.string().min(1).max(200) }),
      execute: async input => {
        if (!runtime.memberRole || !["owner", "manager", "editor"].includes(runtime.memberRole)) return { status: "unavailable", message: "View-only members cannot draft plan changes." };
        const source = runtime.toolResults.flatMap(result => result.evidence).find(item => item.id === input.evidenceId && item.recordId === input.billId && item.type === "bill");
        if (!source) return { status: "unavailable", message: "Read the exact bill before drafting this change." };
        const amount = money(input.newAmount);
        if (amount === null) return { status: "unavailable", message: "The requested amount is invalid." };
        const record = runtime.toolResults.flatMap(result => result.records).find((item: any) => item?.id === input.billId);
        if (!record || money((record as any).amount) === null) return { status: "unavailable", message: "The current bill version could not be verified." };
        if ((record as any).is_debt === true || (record as any).is_recurring !== true) return { status: "unavailable", message: "Only a recurring non-debt bill can be changed through this review." };
        const verifiedName = String((record as any).name ?? "bill").slice(0, 70);
        const expectedAmount = money((record as any).amount)!;
        const frequency = String((record as any).frequency ?? "recurring").slice(0, 30);
        runtime.proposalDraft = { kind: "recurring_bill_change", title: `Change ${verifiedName}`, summary: `Review changing the ${frequency} planned amount for ${verifiedName} from $${expectedAmount.toFixed(2)} to $${amount.toFixed(2)} per occurrence. This does not move money; FlowLedger will recompute the forecast after confirmation.`, payload: { billId: input.billId, newAmount: amount, expectedAmount, expectedLastReviewedAt: (record as any).last_reviewed_at ?? null, frequency }, evidenceIds: [input.evidenceId] };
        runtime.toolNames.push("draftRecurringBillChange");
        return { status: "review", proposal: runtime.proposalDraft };
      },
    }),
  };
}

export function summarizeToolPayload(payload: FloToolEnvelope) {
  return {
    status: payload.status,
    dataAsOf: payload.dataAsOf,
    coverage: payload.coverage,
    evidence: payload.evidence,
    records: payload.records,
    summary: payload.summary,
  };
}

export function numericTotal(records: unknown[], field: string): number | null {
  const values = records.map(record => money((record as Record<string, unknown>)?.[field])).filter((value): value is number => value !== null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
}


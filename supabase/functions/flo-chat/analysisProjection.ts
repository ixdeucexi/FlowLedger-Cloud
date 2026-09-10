import { createFinancialProjection } from "../../../artifacts/mobile/lib/financialProjection.ts";
import { normalizeSettingsRow, normalizeBillRow, normalizeMonthlyOverrideRow, normalizeBillDateMoveRow, normalizeTransactionRow, normalizeAccountRow, normalizeConnectedBankRows, normalizePendingBankRows, normalizePendingPlanMatchRow, normalizeGoalRow, normalizeExtraPaymentRow, accountAwareTransactionCollections, checkingPendingBankRows } from "../../../artifacts/mobile/lib/financialProjectionInput.ts";
import { canonicalConnectedAccounts, visiblePendingPlaidActivity, pendingPlaidActivityWithBalanceHolds } from "../../../artifacts/mobile/lib/plaidActivity.ts";
import { operatingAccountAnchor, connectedCheckingObservedAnchor } from "../../../artifacts/mobile/lib/accounts.ts";
import type { FinancialProjectionSnapshot } from "../../../artifacts/mobile/lib/financialProjectionTypes.ts";
import { analyticTransactions, aggregateSpending } from "./analysisSpending.ts";
import { scheduleAnalysis } from "./analysisSchedule.ts";
import { validIncomeEffectiveFrom, validIncomeExcludedDate } from "./analysisIncomeDates.ts";
import { dayAdd, dollars, label, matches, monthEnd, monthStart, numeric, requireSources, round, shiftMonth, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export const projectionSources = ["household_settings", "bills", "monthly_overrides", "bill_date_moves", "transactions", "accounts", "plaid_accounts", "plaid_transactions", "pending_plan_matches", "incomes", "goals", "extra_payments", "decisions"];

const strictNumber = (v: unknown): number | null => (typeof v === "number" || (typeof v === "string" && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim()))) && Number.isFinite(Number(v)) ? Number(v) : null;
const exactName = (value: unknown, query: string | null) => !query || String(value ?? "").trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase();

export function projectionInput(snapshot: AnalysisSnapshot): { input: FinancialProjectionSnapshot; missing: string[]; anchorDate: string | null; current: number | null; availableNow: number | null; savings: number | null } {
  const rows = (name: string) => snapshot.sources[name]?.rows ?? [];
  const missing = requireSources(snapshot, projectionSources);
  const rawSettings = rows("household_settings")[0];
  const numberFields = (table: string, fields: string[], optional = false) => rows(table).forEach(r => fields.forEach(field => {
    if (optional && r[field] == null) return;
    if (strictNumber(r[field]) === null) missing.push(`${table}.${field} is unavailable or invalid`);
  }));
  numberFields("household_settings", ["starting_balance", "safety_floor", "forecast_horizon_months"]);
  for (const table of ["bills", "transactions", "incomes", "extra_payments", "plaid_transactions"]) numberFields(table, ["amount"]);
  numberFields("monthly_overrides", ["paid_amount", "month", "year"]);
  numberFields("monthly_overrides", ["custom_amount", "actual_amount", "planned_debt_amount", "required_debt_amount", "custom_due_day"], true);
  numberFields("goals", ["target_amount", "current_amount"]);
  numberFields("transactions", ["debt_applied_amount"], true);
  numberFields("bills", ["snowball_minimum_boost"], true);
  for (const table of ["monthly_overrides", "extra_payments"]) for (const row of rows(table)) {
    if (!Number.isInteger(strictNumber(row.month)) || row.month < 0 || row.month > 11 || !Number.isInteger(strictNumber(row.year)) || row.year < 1900 || row.year > 9999) missing.push(`${table} has an invalid month or year`);
  }
  for (const table of ["accounts", "plaid_accounts"]) for (const row of rows(table).filter(r=>r.is_active !== false)) {
    if (strictNumber(row.current_balance) === null) missing.push(`${table}.current_balance is unavailable`);
    if (row.available_balance != null && strictNumber(row.available_balance) === null) missing.push(`${table}.available_balance is invalid`);
  }
  for (const row of rows("pending_plan_matches").filter(r=>["active","ready_review"].includes(r.status))) {
    if ([row.planned_amount,row.pending_amount,...(row.status === "ready_review" ? [row.posted_amount] : [])].some(v=>strictNumber(v) === null) || !validDate(row.occurrence_date) || !validDate(row.pending_transaction_date)) missing.push("A pending settlement amount or date is invalid");
  }
  for (const row of rows("decisions").filter(r=>["planned","calendar"].includes(r.status))) {
    if (strictNumber(row.scenario?.amount) === null || !validDate(row.scenario?.date)) missing.push("A planned decision amount or date is unavailable");
  }
  for (const table of ["transactions", "extra_payments", "incomes"]) for (const row of rows(table)) {
    for (const field of table === "transactions" ? ["review_allocations"] : table === "incomes" ? ["amount_history"] : ["allocations", "sources"]) {
      if (row[field] != null && (!Array.isArray(row[field]) || row[field].some((entry: any) => strictNumber(entry?.[field === "allocations" ? "payment" : "amount"]) === null))) missing.push(`${table}.${field} contains an invalid amount`);
      if (Array.isArray(row[field])) for (const entry of row[field]) {
        if (entry == null || typeof entry !== "object") { missing.push(`${table}.${field} contains an invalid entry`); continue; }
        for (const number of ["plannedAmount", "balanceBefore", "balanceAfter"]) if (entry[number] != null && strictNumber(entry[number]) === null) missing.push(`${table}.${field}.${number} is invalid`);
        for (const date of ["occurrenceDate", "paymentDate", "availableDate"]) if (entry[date] != null && !validDate(entry[date])) missing.push(`${table}.${field}.${date} is invalid`);
      }
    }
  }
  const dates = (table: string, fields: string[], optional = false) => rows(table).forEach(row => fields.forEach(field => {
    if (optional && row[field] == null) return;
    if (!validDate(row[field])) missing.push(`${table}.${field} is unavailable or invalid`);
  }));
  dates("transactions", ["date"]); dates("plaid_transactions", ["transaction_date"]);
  dates("bill_date_moves", ["from_date", "to_date"]); dates("goals", ["target_date"]);
  dates("bills", ["start_date", "end_date", "next_payment_date"], true);
  dates("incomes", ["start_date", "next_payment_date"], true);
  dates("monthly_overrides", ["paid_date"], true); dates("extra_payments", ["payment_date"], true);
  for (const income of rows("incomes")) {
    if (!["monthly", "biweekly", "weekly"].includes(income.frequency) || !validDate(income.start_date ?? income.next_payment_date)) missing.push("An income recurrence anchor or frequency is unavailable");
    if (!Array.isArray(income.amount_history ?? []) || !Array.isArray(income.excluded_dates ?? []) || (income.amount_history ?? []).some((e: any) => !validIncomeEffectiveFrom(e?.effective_from)) || (income.excluded_dates ?? []).some((d: any) => !validIncomeExcludedDate(d))) missing.push("An income history or excluded date is invalid");
  }
  for (const bill of rows("bills")) {
    if (typeof bill.is_debt !== "boolean" || typeof bill.is_recurring !== "boolean" || !["monthly", "quarterly", "weekly", "biweekly"].includes(bill.frequency) || !Number.isInteger(strictNumber(bill.due_day)) || bill.due_day < 1 || bill.due_day > 31) missing.push("A bill recurrence or debt classification is invalid");
    if (bill.is_debt && [bill.balance, bill.interest_rate].some(v => strictNumber(v) === null || Number(v) < 0)) missing.push("A debt balance or APR is invalid");
    if (["weekly","biweekly"].includes(bill.frequency) && (!Number.isInteger(strictNumber(bill.day_of_week)) || bill.day_of_week < 0 || bill.day_of_week > 6)) missing.push("A weekly bill weekday is unavailable or invalid");
  }
  if (!validDate(snapshot.today) || !Number.isFinite(Date.parse(snapshot.capturedAt))) missing.push("The analysis clock is invalid");
  try { new Intl.DateTimeFormat("en-US",{timeZone:snapshot.timeZone}).format(new Date(snapshot.capturedAt)); } catch { missing.push("The household time zone or analysis clock is invalid"); }
  if (!Number.isInteger(strictNumber(rawSettings?.forecast_horizon_months)) || rawSettings?.forecast_horizon_months < 1 || rawSettings?.forecast_horizon_months > 24 || rawSettings?.safety_floor < 0) missing.push("The forecast horizon or cushion is invalid");
  if (!rawSettings || numeric(rawSettings.starting_balance) === null || numeric(rawSettings.safety_floor) === null) missing.push("A starting balance and cash cushion are required");
  for (const table of ["bills", "transactions", "incomes", "extra_payments"]) if (rows(table).some(r => numeric(r.amount) === null)) missing.push(`${table} contains an unavailable amount`);
  if (rows("bills").some(r => r.is_debt && (numeric(r.balance) === null || numeric(r.interest_rate) === null))) missing.push("A debt balance or APR is missing");
  if (rows("accounts").some(r => r.is_active !== false && numeric(r.current_balance) === null)) missing.push("An account balance is unavailable");
  const identities = normalizeConnectedBankRows(rows("plaid_accounts"));
  const connected = canonicalConnectedAccounts(identities);
  const transactions = accountAwareTransactionCollections(rows("transactions"), identities);
  const pending = checkingPendingBankRows(normalizePendingBankRows(visiblePendingPlaidActivity(rows("plaid_transactions").filter(r => r.pending && !r.removed_at) as any, identities)), identities);
  if (transactions.unknownPlaid.length || pending.unknownCount) missing.push("Some bank activity has no verified account identity");
  const accounts = rows("accounts").filter(r => r.account_type !== "credit_card").map(normalizeAccountRow);
  const bankAnchor = connectedCheckingObservedAnchor(connected, snapshot.timeZone);
  const manualAnchor = operatingAccountAnchor(accounts.map(a => ({ id: a.id, name: a.name, type: a.account_type, currentBalance: a.current_balance, balanceAsOf: a.balance_as_of, active: a.is_active })));
  const hasBankChecking = connected.some(a => a.account_subtype === "checking");
  const anchor = hasBankChecking ? bankAnchor : manualAnchor ?? (validDate(rawSettings?.starting_balance_date) && numeric(rawSettings?.starting_balance) !== null ? { date: rawSettings.starting_balance_date, balance: Number(rawSettings.starting_balance) } : null);
  if (!anchor) missing.push("A dated, consistent checking/cash balance is required");
  if (anchor && anchor.date > snapshot.today) missing.push("The balance observation is dated in the future");
  if (anchor && anchor.date < dayAdd(snapshot.today, -7)) missing.push("The checking balance is more than seven days old; refresh or reconcile it before making a spending decision");
  const bankSavings = connected.filter(a => a.account_subtype === "savings");
  const manualSavings = accounts.filter(a => a.is_active && a.account_type === "savings");
  const savings = bankSavings.length ? (bankSavings.every(a => a.current_balance_available) ? sum(bankSavings.map(a => a.current_balance)) : null) : manualSavings.length ? sum(manualSavings.map(a => a.current_balance)) : null;
  const input: FinancialProjectionSnapshot = {
    settings: normalizeSettingsRow(rawSettings), bills: rows("bills").map(normalizeBillRow), overrides: rows("monthly_overrides").map(normalizeMonthlyOverrideRow), billDateMoves: rows("bill_date_moves").map(normalizeBillDateMoveRow), transactions: transactions.active.map(normalizeTransactionRow), deletedTransactions: transactions.deleted, incomes: rows("incomes").map(r => ({ ...r, amount: Number(r.amount), amount_history: r.amount_history ?? [], excluded_dates: r.excluded_dates ?? [] })) as any,
    goals: rows("goals").map(normalizeGoalRow), extraPayments: rows("extra_payments").map(normalizeExtraPaymentRow), decisions: rows("decisions") as any, accounts, connectedBankAccounts: connected, transactionAccountIdentities: identities, pendingBankTransactions: pendingPlaidActivityWithBalanceHolds(pending.included, identities, snapshot.today), pendingPlanMatches: rows("pending_plan_matches").filter(r => ["active", "ready_review"].includes(r.status)).map(normalizePendingPlanMatchRow),
  };
  const pendingOutflows = -sum(input.pendingBankTransactions.filter(r => r.amount < 0).map(r => r.amount));
  const availableNow = anchor ? round(anchor.balance - pendingOutflows) : null;
  return { input, missing: [...new Set(missing)], current: anchor?.balance ?? null, availableNow, anchorDate: anchor?.date ?? null, savings };
}

export function buildAnalysisForecast(snapshot: AnalysisSnapshot, endDate: string) {
  if (!validDate(endDate) || !validDate(snapshot.today) || endDate < snapshot.today) throw new Error("Forecast dates must be valid and not historical; historical balances require recorded daily closes");
  const normalized = projectionInput(snapshot);
  if (normalized.missing.length) throw new Error(normalized.missing.join("; "));
  const engine = createFinancialProjection(normalized.input, { now: new Date(snapshot.capturedAt), timeZone: snapshot.timeZone });
  const horizonEnd = monthEnd(shiftMonth(snapshot.today, normalized.input.settings.forecast_horizon_months - 1));
  if (endDate > horizonEnd) throw new Error(`The requested date is beyond the configured forecast ending ${horizonEnd}`);
  const days = [];
  for (let month = monthStart(snapshot.today); month <= endDate; month = shiftMonth(month, 1)) {
    days.push(...engine.getDailyBalances(Number(month.slice(5,7)) - 1, Number(month.slice(0,4))).filter(d => d.balanceDate >= snapshot.today && d.balanceDate <= endDate));
  }
  const history = analyticTransactions(snapshot);
  const priorStart = shiftMonth(snapshot.today, -3);
  const priorEnd = dayAdd(monthStart(snapshot.today), -1);
  const prior = aggregateSpending(history.rows.filter(r => !r.billId), priorStart, priorEnd);
  const historyAvailable = [1,2,3].every(months => history.rows.some(r => r.date >= shiftMonth(snapshot.today,-months) && r.date <= monthEnd(shiftMonth(snapshot.today,-months)))) && !history.missing.length && !prior.unresolved;
  const historyDays = (Date.parse(priorEnd) - Date.parse(priorStart)) / 86400000 + 1;
  const dailyEstimate = historyAvailable ? Math.max(0, round(prior.spending / historyDays)) : 0;
  let estimate = 0;
  const projected = days.map(d => { if (d.balanceDate > snapshot.today) estimate = round(estimate + dailyEstimate); return { date: d.balanceDate, balance: round(d.balance), estimatedBalance: round(d.balance - estimate), estimatedSpending: estimate, events: d.projectionEvents ?? [] }; });
  const affordabilityMissing: string[] = [];
  // Old unpaid obligations are not moved into today's forecast by the app
  // engine. Do not infer that a fresh bank observation settled those bills.
  for (const bill of snapshot.sources.bills?.rows ?? []) {
    const recordedOrigin = bill.start_date ?? String(bill.created_at ?? "").slice(0,10);
    if (!validDate(recordedOrigin)) { affordabilityMissing.push("A bill's recorded start date is needed to verify older unpaid obligations"); continue; }
    // Without an explicit start, canonical recurrence includes earlier due
    // days in the creation month. Creation time is not an occurrence cutoff.
    const origin = bill.start_date ? recordedOrigin : monthStart(recordedOrigin);
    if (origin >= snapshot.today) continue;
    const earliest = monthStart(shiftMonth(snapshot.today,-23));
    if (origin < earliest) { affordabilityMissing.push("Older bill settlement history extends beyond the checked 24-month window; review arrears before spending"); continue; }
    const past = scheduleAnalysis({...snapshot,sources:{...snapshot.sources,bills:{...snapshot.sources.bills,rows:[bill]}}}, {domain:"bills",operation:"summary",startDate:origin,endDate:dayAdd(snapshot.today,-1),dateEvent:"none",entity:null} as AnalysisRequest);
    if (past.missing.length || Number(past.facts.remainingObligations) > 0) affordabilityMissing.push("Older bill obligations remain unpaid or unverified; review them before relying on a safe-to-spend amount");
  }
  return { ...normalized, engine, days: projected, dailyEstimate, historyAvailable, horizonEnd, affordabilityMissing:[...new Set(affordabilityMissing)], missing: [...normalized.missing, ...history.missing] };
}

export function forecastAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  if (["forecast","money"].includes(request.domain) && request.entity && request.dateEvent === "none") return {text:"The available forecast covers household checking/cash, not an individual named account. Ask for the household forecast or the named account's recorded balance.",facts:{},sources:projectionSources,assumptions:[],missing:["Named-account forecast scope is not available"],scenario:false};
  if (request.operation === "compare" && (!validDate(request.comparisonStart) || !validDate(request.comparisonEnd) || request.comparisonStart! > request.comparisonEnd! || request.comparisonStart! < snapshot.today)) return {text:"Choose two valid current or future forecast windows. A historical comparison requires recorded closing balances; today's forecast cannot stand in for those observations.",facts:{},sources:projectionSources,assumptions:[],missing:["The comparison window is missing, invalid or historical"],scenario:false};
  const start = request.startDate ?? snapshot.today;
  if (!validDate(start) || start < snapshot.today || (request.endDate !== null && (!validDate(request.endDate) || request.endDate < start))) throw new Error("Choose a valid current or future date window; historical balances require recorded closes");
  if (request.amount !== null && (strictNumber(request.amount) === null || request.amount < 0)) throw new Error("A nonnegative finite amount is required");
  const configuredEnd = monthEnd(shiftMonth(snapshot.today, Number(snapshot.sources.household_settings?.rows[0]?.forecast_horizon_months ?? 1) - 1));
  const preliminaryEnd = request.endDate ?? (request.dateEvent !== "none" ? configuredEnd : monthEnd(start));
  if (preliminaryEnd > configuredEnd) throw new Error(`The requested date is beyond the configured forecast ending ${configuredEnd}`);
  // Every emitted safe-to-spend figure must protect later obligations, even
  // when the requested balance/reporting window is only today.
  const affordabilityRiskEnd = [monthEnd(shiftMonth(preliminaryEnd,1)),configuredEnd].sort()[0];
  let forecast = buildAnalysisForecast(snapshot, affordabilityRiskEnd);
  const upcoming = forecast.days.flatMap(d => d.events).filter(e => e.date >= start && !["actual", "applied", "finalized"].includes(e.status));
  if (request.entity && (request.domain === "income" || request.dateEvent !== "none")) {
    const candidates = request.dateEvent === "after_bill" ? forecast.input.bills : forecast.input.incomes;
    if (candidates.filter(e => exactName(e.name, request.entity)).length !== 1) return {text:"Please identify exactly one recorded income source or bill by its full name.", facts:{}, sources:projectionSources, assumptions:[], missing:["The named scheduled source is missing or ambiguous"], scenario:false};
  }
  const incomeEvents = upcoming.filter(e => e.kind === "scheduled_income" && e.amount > 0 && exactName(e.name, request.dateEvent !== "after_bill" ? request.entity : null)).sort((a,b)=>a.date.localeCompare(b.date));
  const nextPayday = incomeEvents[0]?.date;
  let end = request.endDate ?? (request.domain === "money" || request.domain === "paycheck" || request.domain === "purchase" ? nextPayday && nextPayday > start ? dayAdd(nextPayday, -1) : monthEnd(start) : monthEnd(start));
  if (request.domain === "purchase" && request.operation === "plan" && request.endDate === null) end = preliminaryEnd;
  if (request.dateEvent !== "none") {
    if (request.dateEvent === "after_bill") {
      const events = upcoming.filter(e=>e.amount < 0 && ["bill", "debt_payment"].includes(e.kind) && exactName(e.name, request.entity));
      if (!request.entity || !events.length) forecast.missing.push("Name the upcoming bill whose payment date you mean"); else end = events.sort((a,b)=>a.date.localeCompare(b.date))[0].date;
    } else if (!nextPayday) forecast.missing.push("No upcoming paycheck is scheduled within the forecast window");
    else end = request.dateEvent === "before_payday" ? dayAdd(nextPayday, -1) : nextPayday;
  }
  if (forecast.missing.length || end < start) return {text:"I cannot resolve that scheduled event within the requested window.",facts:{},sources:projectionSources,assumptions:[],missing:[...forecast.missing,"A valid upcoming event date is required"],scenario:false};
  const days = forecast.days.filter(d=>d.date >= start && d.date <= end);
  if (!days.length) throw new Error("No future forecast days are available");
  const last = days[days.length - 1];
  // A target-date balance includes the path from today to that date. Explicit
  // range/minimum queries still summarize only their requested window.
  const targetDateBalance = request.domain === "forecast" && ["summary", "detail"].includes(request.operation) && request.startDate === request.endDate;
  const contextStart = targetDateBalance ? snapshot.today : start;
  const contextDays = targetDateBalance ? forecast.days.filter(d=>d.date <= end) : days;
  const lowest = contextDays.reduce((a,b)=>a.estimatedBalance <= b.estimatedBalance ? a : b);
  const floor = forecast.input.settings.safety_floor;
  const events = contextDays.flatMap(d=>d.events).filter(e=>e.date >= contextStart && e.date <= end && !["actual", "applied", "finalized"].includes(e.status));
  const obligations = -sum(events.filter(e=>e.amount < 0).map(e=>e.amount)) || 0;
  const income = sum(events.filter(e=>e.amount > 0 && e.kind === "scheduled_income" && exactName(e.name, request.domain === "income" ? request.entity : null)).map(e=>e.amount));
  const riskEnd = affordabilityRiskEnd;
  const riskLow = forecast.days.filter(d => d.date <= riskEnd).reduce((a,b)=>a.estimatedBalance<=b.estimatedBalance?a:b);
  const throughLow = riskLow.estimatedBalance;
  const safe = forecast.historyAvailable && !forecast.missing.length && !forecast.affordabilityMissing.length && forecast.availableNow !== null && forecast.anchorDate === snapshot.today ? round(Math.max(0, Math.min(forecast.availableNow, throughLow) - floor)) : null;
  const facts: AnalysisResult["facts"] = { startDate:start, contextStartDate:contextStart, projectedBalance: last.balance, projectedAfterEstimatedSpending: forecast.historyAvailable ? last.estimatedBalance : null, safeToSpendUnderPlan: safe, obligations, expectedIncome: income, minimumProjectedBalance: lowest.estimatedBalance, minimumDate: lowest.date, targetDate: end, cashCushion: floor, nextPayday: nextPayday ?? null, observedBalance: forecast.current, balanceAsOf: forecast.anchorDate, conservativeAvailableNow:forecast.availableNow };
  facts.affordabilityAssessmentThrough=riskEnd;facts.affordabilityMinimumBalance=riskLow.estimatedBalance;facts.affordabilityMinimumDate=riskLow.date;
  const assumptions = ["Forecasts reuse FlowLedger's current bills, date moves, income schedule, debt allocations, pending-payment matches, and planned goals. Future deposits are expected, not guaranteed. Same-day end balances do not establish the order a bank will post payments.", forecast.historyAvailable ? `Estimated additional daily spending is ${dollars(forecast.dailyEstimate)}, based on the last three completed months of recorded non-bill-linked spending; this may overlap unlinked recurring charges.` : "No reliable three-month spending baseline is available. This is a scheduled-plan projection, not assurance that unrecorded living expenses are covered."];
  const missing = [...forecast.missing,...forecast.affordabilityMissing];
  const lines: string[] = [];
  if (request.domain === "bills" || request.domain === "subscriptions") {
    if (request.entity && forecast.input.bills.filter(b=>exactName(b.name,request.entity)).length !== 1) return {text:"Please identify one bill by its full recorded name.",facts:{},sources:projectionSources,assumptions:[],missing:["The named bill is missing or ambiguous"],scenario:false};
    const relevant = events.filter(e=>e.amount < 0 && ["bill", "debt_payment"].includes(e.kind) && exactName(e.name, request.entity));
    const selected = request.domain === "subscriptions" ? relevant.filter(e=>/subscription|entertainment|stream|software/i.test(forecast.input.bills.find(b=>b.id===e.sourceId)?.category ?? "")) : relevant;
    facts.obligations = -sum(selected.map(e=>e.amount)) || 0;
    lines.push(`${dollars(Number(facts.obligations))} in remaining ${request.domain === "subscriptions" ? "subscription-category" : "bill and debt"} obligations from ${start} through ${end}.`, ...selected.slice(0,8).map(e=>`${e.date}: ${label(e.name)}, ${dollars(-e.amount)} (${e.status}).`));
    if (request.domain === "subscriptions") assumptions.push("Subscription matches use your recorded categories; recurring bills are not automatically subscriptions. Review categories to identify missing subscriptions.");
  } else if (request.domain === "income") {
    const selectedIncome = incomeEvents.filter(e=>e.date<=end);
    facts.expectedPaymentCount = selectedIncome.length;
    facts.averageExpectedPayment = selectedIncome.length ? round(income/selectedIncome.length) : null;
    lines.push(`${dollars(income)} in expected scheduled income from ${start} through ${end}${request.entity ? ` for ${label(request.entity)}` : ""}.`, ...selectedIncome.slice(0,6).map(e=>`${e.date}: ${label(e.name)}, ${dollars(e.amount)}.`));
  } else {
    const observedLine = `Your recorded checking/cash balance is ${dollars(forecast.current!)} as of ${forecast.anchorDate}; this is not a live bank-funds guarantee.`;
    const projectedLine = `Your projected end-of-day account balance on ${end} is ${dollars(last.balance)}${forecast.historyAvailable ? `, or ${dollars(last.estimatedBalance)} after estimated everyday spending` : " under the recorded plan"}.`;
    lines.push(...(request.domain === "money" && request.operation === "detail" ? [observedLine, projectedLine] : [projectedLine, observedLine]));
    lines.push(`Between ${contextStart} and ${end}, the lowest projected balance is ${dollars(lowest.estimatedBalance)} on ${lowest.date}. That window includes ${dollars(income)} of expected income and ${dollars(obligations)} of remaining obligations.`);
    lines.push(safe === null ? "A safe-to-spend amount is unavailable without a reliable spending baseline, verified funds and resolved older obligations." : riskLow.estimatedBalance<floor?`No additional spending is supported by this check: the plan already falls below your ${dollars(floor)} cushion through ${riskEnd}.`:`Up to ${dollars(safe)} of additional spending fits this checked plan while keeping your ${dollars(floor)} cushion through ${riskEnd}, capped by recorded funds after pending outflows. This is not a guarantee of available bank funds.`);
    if(riskEnd!==end)lines.push(`The affordability check continues beyond the displayed balance date through ${riskEnd}; its lowest projected balance is ${dollars(riskLow.estimatedBalance)} on ${riskLow.date}. Bills beyond that assessment horizon are not included.`);
    if (lowest.estimatedBalance < floor) lines.push(`Your plan falls ${dollars(floor-lowest.estimatedBalance)} below your cushion. Protect essential bills and reduce or move optional outflows before that date.`);
    else if(riskLow.estimatedBalance<floor)lines.push(`Later obligations take the plan ${dollars(floor-riskLow.estimatedBalance)} below your cushion on ${riskLow.date}; today's balance is not all spare money.`);
  }
  if (request.amount !== null && request.domain === "purchase") {
    facts.purchaseAmount = request.amount;
    facts.purchaseRiskAssessmentThrough = riskEnd;
    facts.afterPurchaseLow = round(throughLow-request.amount);
    if (request.operation === "plan") {
      // A purchase shifts every remaining end balance by the same amount. A
      // suffix minimum checks all later obligations, not just the purchase day.
      let remainingLow = Infinity;
      let candidate: {date: string; low: number} | null = null;
      const riskDays=forecast.days.filter(d=>d.date>=start&&d.date<=riskEnd);
      if (safe !== null && !missing.length) for (let index = riskDays.length - 1; index >= 0; index--) {
        remainingLow = Math.min(remainingLow, riskDays[index].estimatedBalance);
        const afterPurchase = round(remainingLow - request.amount);
        if (riskDays[index].date <= end && afterPurchase >= floor && (riskDays[index].date !== snapshot.today || request.amount <= safe)) candidate = {date:riskDays[index].date,low:afterPurchase};
      }
      facts.earliestProjectedPurchaseDate = candidate?.date ?? null;
      facts.afterPurchaseLow = candidate?.low ?? null;
      facts.purchaseProjectionThrough = riskEnd;
      lines.unshift(candidate
        ? `The earliest projected purchase date for ${dollars(request.amount)} is ${candidate.date}, after that day's expected payments have posted. The projected balance stays at or above ${dollars(candidate.low)} through ${riskEnd}, preserving your ${dollars(floor)} cushion. This is projected future ability, not money verified available now; recheck your bank funds before buying.`
        : safe === null ? `I cannot identify a reliable purchase date for ${dollars(request.amount)} without a current balance observation and a reliable spending baseline.`
        : `No purchase date from ${start} through ${end} keeps every remaining projected balance above your ${dollars(floor)} cushion through ${riskEnd} for a ${dollars(request.amount)} purchase.`);
      assumptions.push("The purchase-date check uses checking/cash only, not savings. It assumes one purchase after that day's expected cash flows; it covers only the stated forecast horizon, not bills beyond it.");
    } else lines.unshift(safe !== null && request.amount <= safe && !missing.length ? `A ${dollars(request.amount)} purchase fits this projection through ${riskEnd}, with the listed assumptions.` : `I cannot confirm that a ${dollars(request.amount)} purchase is safe. It would leave the scheduled projected low through ${riskEnd} at ${dollars(throughLow-request.amount)}; check the cushion and missing information below.`);
  }
  if (request.operation === "threshold" && request.amount !== null) {
    const hit = days.find(d=>d.estimatedBalance >= request.amount!);
    const below = days.find(d=>d.estimatedBalance < request.amount!);
    lines.unshift(hit ? `The first projected end balance at or above ${dollars(request.amount)} is ${hit.date}.` : `No projected end balance reaches ${dollars(request.amount)} by ${end}.`, below ? `The first end balance below that threshold is ${below.date}.` : "No projected end balance falls below that threshold in this window.");
  }
  if (request.operation === "minimum") lines.unshift(`The lowest projected end balance between ${contextStart} and ${end} is ${dollars(lowest.estimatedBalance)} on ${lowest.date}${forecast.historyAvailable ? " after estimated everyday spending" : " under the recorded schedule"}.`);
  if (request.operation === "maximum") {
    const maximum=days.reduce((a,b)=>a.estimatedBalance>=b.estimatedBalance?a:b);
    facts.maximumProjectedBalance=maximum.estimatedBalance;facts.maximumDate=maximum.date;
    lines.unshift(`The highest projected end balance between ${start} and ${end} is ${dollars(maximum.estimatedBalance)} on ${maximum.date}${forecast.historyAvailable ? " after estimated everyday spending" : " under the recorded schedule"}.`);
  }
  if (request.operation === "compare") {
    const comparison=buildAnalysisForecast(snapshot,request.comparisonEnd!);
    const comparisonDays=comparison.days.filter(d=>d.date>=request.comparisonStart!&&d.date<=request.comparisonEnd!);
    if(!comparisonDays.length)return {text:"No forecast days cover the comparison window.",facts:{},sources:projectionSources,assumptions:[],missing:["The requested comparison is unavailable"],scenario:false};
    const comparisonEnd=comparisonDays[comparisonDays.length-1];
    const comparisonLow=comparisonDays.reduce((a,b)=>a.estimatedBalance<=b.estimatedBalance?a:b);
    facts.comparisonStartDate=request.comparisonStart!;facts.comparisonEndDate=request.comparisonEnd!;
    facts.comparisonEndBalance=comparisonEnd.estimatedBalance;facts.comparisonMinimumBalance=comparisonLow.estimatedBalance;facts.comparisonMinimumDate=comparisonLow.date;
    facts.endBalanceDifference=round(last.estimatedBalance-comparisonEnd.estimatedBalance);
    facts.minimumBalanceDifference=round(lowest.estimatedBalance-comparisonLow.estimatedBalance);
    lines.unshift(`Forecast comparison: ${start}–${end} ends at ${dollars(last.estimatedBalance)} with a low of ${dollars(lowest.estimatedBalance)} on ${lowest.date}; ${request.comparisonStart}–${request.comparisonEnd} ends at ${dollars(comparisonEnd.estimatedBalance)} with a low of ${dollars(comparisonLow.estimatedBalance)} on ${comparisonLow.date}. The first window's end balance is ${dollars(Math.abs(Number(facts.endBalanceDifference)))} ${Number(facts.endBalanceDifference)>=0?"higher":"lower"}. Both use ${forecast.historyAvailable?"the same estimated everyday-spending baseline":"the recorded schedule without an everyday-spending baseline"}.`);
    missing.push(...comparison.missing,...comparison.affordabilityMissing);
  }
  return { text: lines.join("\n\n"), facts, sources: projectionSources, assumptions, missing: [...new Set(missing)], scenario: false };
}

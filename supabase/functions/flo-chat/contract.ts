export const FLO_V3_POLICY_VERSION = "flo-v3.0.0";
// Three bounded tool rounds plus the final structured-output round and one
// safety round. Parallel tool calls are disabled by the provider options.
export const FLO_V3_MAX_TOOL_STEPS = 5;
export const FLO_V3_MAX_ROWS = 200;
export const FLO_V3_MAX_BODY_BYTES = 65_536;

export type FloCoverage = {
  complete: boolean;
  returned: number;
  limit: number;
  startDate?: string;
  endDate?: string;
  exclusions?: string[];
  reason?: string;
};

export type FloSourceRef = {
  id: string;
  type: string;
  label: string;
  recordId?: string;
  route?: string;
  asOf: string | null;
  freshness: "current" | "stale" | "unknown";
  startDate?: string;
  endDate?: string;
};

export type FloToolEnvelope = {
  status: "ok" | "partial" | "unavailable";
  dataAsOf: string | null;
  coverage: FloCoverage;
  evidence: FloSourceRef[];
  records: unknown[];
  summary?: Record<string, unknown>;
  message?: string;
};

export type FloProposal = {
  id: string;
  kind: "planned_decision" | "bill_date_change" | "category_budget_change" | "extra_debt_payment" | "recurring_bill_change";
  title: string;
  summary: string;
  impact?: Record<string, unknown>;
  reversible: boolean;
  expiresAt: string;
  status: "review" | "confirmed" | "expired" | "rejected" | "failed";
  payload: Record<string, unknown>;
};

export type FloGroundedAnswer = {
  answer: string;
  claims: Array<{
    kind: "amount" | "date" | "entity" | "count" | "status";
    label: string;
    field: string;
    value: string;
    evidenceIds: string[];
  }>;
  caveat: string | null;
  evidenceIds: string[];
  followups: string[];
};

export type FloCapabilityGuidance = {
  answer: string;
  source: FloSourceRef;
};

export type FloVerifiedFallback = {
  answer: string;
  sources: FloSourceRef[];
  dataAsOf: string | null;
  coverage: Record<string, unknown>;
  partial: true;
  caveat: string;
  followups: string[];
};

export type FloDeterministicIntent = "forecast_overview" | "account_overview" | "bill_overview" | "debt_overview" | "debt_plan_history" | "income_overview" | "activity_overview" | "budget_goal_overview" | "connection_health";

export type FloDeterministicToolName =
  | "getAccountOverview"
  | "getBillsAndDebt"
  | "getIncomeSchedule"
  | "searchTransactions"
  | "getBudgetsAndGoals"
  | "getDebtPlanHistory"
  | "getConnectionHealth"
  | "getHouseholdAndSettings";

export type FloDeterministicRoute = {
  intent: FloDeterministicIntent;
  requests: Array<{ name: FloDeterministicToolName; input: Record<string, unknown> }>;
};

export type FloDeterministicAnswer = {
  answer: FloGroundedAnswer;
  sources: FloSourceRef[];
  dataAsOf: string | null;
  coverage: ReturnType<typeof aggregateCoverage>["coverage"];
  partial: boolean;
};

const helpSource = (id: string, label: string, route: string): FloSourceRef => ({
  id: `help:${id}`,
  type: "help",
  label,
  route,
  asOf: null,
  freshness: "unknown",
});

export function floCapabilityGuidance(question: string): FloCapabilityGuidance | null {
  const normalized = question.trim().toLowerCase();
  if (/\bflow\s*score\b/.test(normalized)) {
    return {
      answer: "Flo cannot verify the exact Flow Score breakdown in chat yet. Open How FlowLedger Works to see the factors the live Dashboard uses and what each part means.",
      source: helpSource("flow-score", "How FlowLedger Works", "/(tabs)/how-flowledger-works"),
    };
  }
  if ((/\b(?:safe|safely|afford|extra)\b.*\bdebt\b/.test(normalized) || /\bdebt\b.*\b(?:safe|safely|afford|extra)\b/.test(normalized))) {
    return {
      answer: "The Debt Payoff Planner is the verified place to test a safe extra debt payment because it uses your full Forecast. Open the planner to preview the amount and date without changing your plan.",
      source: helpSource("debt-payoff-planner", "Debt Payoff Planner", "/snowball-plan"),
    };
  }
  if (/\b(?:can i afford|safe to spend|spend safely|safe cushion|lowest (?:projected )?balance|until payday|through payday)\b/.test(normalized)) {
    return {
      answer: "Use Plan Simulator to test this against the live Forecast without changing your real plan. Flo cannot reproduce that full safety calculation in chat yet.",
      source: helpSource("plan-simulator", "Plan Simulator", "/plan-simulator"),
    };
  }
  return null;
}

export function deterministicFloRoute(question: string, currentDate?: string): FloDeterministicRoute | null {
  const normalized = question.trim().toLowerCase();
  const recommendation = /\b(?:safe|safely|afford|should i (?:pay|spend|buy)|can i (?:pay|spend|buy)|extra payment|move money)\b/.test(normalized);
  if (recommendation) return null;

  const forecastExplanation = /\b(?:why|what caused|what changed|explain how|how (?:did|was|is))\b/.test(normalized)
    || /\b(?:on|for) \d{4}-\d{2}-\d{2}\b/.test(normalized);
  const simpleForecast = /\b(?:what should i know about|show(?: me)?|review|summarize|tell me about|what does|what(?:'s| is) in) (?:my |the )?forecast\b/.test(normalized)
    || /\bforecast (?:overview|summary|snapshot)\b/.test(normalized)
    || /^(?:my |the )?forecast\??$/.test(normalized);
  if ((!forecastExplanation && (simpleForecast || /\bprojected (?:balance|close|cash flow)\b/.test(normalized))) || /\b(?:bills?|payments?) (?:are )?due next\b|\bwhat(?:'s| is) coming up\b/.test(normalized)) {
    return {
      intent: "forecast_overview",
      requests: [
        { name: "getAccountOverview", input: { includeArchived: false } },
        { name: "getBillsAndDebt", input: { debtOnly: false, includeClosed: false, query: null } },
        { name: "getIncomeSchedule", input: { query: null } },
      ],
    };
  }
  if (/\b(?:debt|snowball|avalanche|extra payment)\b/.test(normalized) && /\b(?:history|saved plans?|past plans?|previous plans?|allocations?)\b/.test(normalized)) {
    return { intent: "debt_plan_history", requests: [{ name: "getDebtPlanHistory", input: { year: null, month: null } }] };
  }
  if (/\b(?:debt|debts|snowball|avalanche)\b/.test(normalized) && /\b(?:balance|balances|total|owe|owing|overview|snapshot|list|which|how much)\b/.test(normalized)) {
    return { intent: "debt_overview", requests: [{ name: "getBillsAndDebt", input: { debtOnly: true, includeClosed: false, query: null } }] };
  }
  if (/\bbills?\b/.test(normalized) && /\b(?:overview|snapshot|list|show|what|which|have|how many|how much)\b/.test(normalized)) {
    return { intent: "bill_overview", requests: [{ name: "getBillsAndDebt", input: { debtOnly: false, includeClosed: false, query: null } }] };
  }
  if (/\b(?:account|accounts|checking|savings)\b/.test(normalized) && /\b(?:balance|balances|total|overview|snapshot|list|which|how much)\b/.test(normalized)) {
    return { intent: "account_overview", requests: [{ name: "getAccountOverview", input: { includeArchived: false } }] };
  }
  if (/\b(?:income|paycheck|paychecks|payday)\b/.test(normalized) && /\b(?:next|when|amount|schedule|overview|snapshot|list|which|how much)\b/.test(normalized)) {
    return { intent: "income_overview", requests: [{ name: "getIncomeSchedule", input: { query: null } }] };
  }
  if (/\b(?:activity|transactions?|spending|spend|spent|purchases?)\b/.test(normalized) && /\b(?:recent|latest|overview|snapshot|list|show|what|how much|this month)\b/.test(normalized)) {
    const monthStart = isDateOnly(currentDate) ? `${currentDate.slice(0, 7)}-01` : null;
    const thisMonth = /\bthis month\b/.test(normalized) && monthStart;
    return { intent: "activity_overview", requests: [{ name: "searchTransactions", input: { startDate: thisMonth ? monthStart : null, endDate: thisMonth ? currentDate : null, query: null, category: null, pending: null, reviewStatus: null, includeDeleted: false, limit: 20 } }] };
  }
  if (/\b(?:budget|budgets|goal|goals|savings goal)\b/.test(normalized) && /\b(?:overview|snapshot|list|show|what|how much|progress|current|status|doing)\b/.test(normalized)) {
    const exactDate = isDateOnly(currentDate) ? currentDate : null;
    return { intent: "budget_goal_overview", requests: [{ name: "getBudgetsAndGoals", input: { year: exactDate ? Number(exactDate.slice(0, 4)) : null, month: exactDate ? Number(exactDate.slice(5, 7)) - 1 : null, includeClosed: false } }] };
  }
  if (/\b(?:plaid|bank|account)\b/.test(normalized) && /\b(?:connect|connection|sync|linked|refresh|status|health)\b/.test(normalized)) {
    return { intent: "connection_health", requests: [{ name: "getConnectionHealth", input: {} }] };
  }
  return null;
}

function directCurrency(value: unknown): string | null {
  const parsed = money(value);
  return parsed === null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parsed);
}

function directPayload(toolNames: string[], payloads: FloToolEnvelope[], name: FloDeterministicToolName): FloToolEnvelope | null {
  const index = toolNames.indexOf(name);
  return index >= 0 ? payloads[index] ?? null : null;
}

function sourceForRecord(payload: FloToolEnvelope | null, recordId: unknown): FloSourceRef | null {
  if (!payload || recordId == null) return null;
  return payload.evidence.find(source => source.recordId === String(recordId)) ?? null;
}

export function deterministicAnswerFromTools(
  intent: FloDeterministicIntent,
  toolNames: string[],
  payloads: FloToolEnvelope[],
): FloDeterministicAnswer | null {
  if (!payloads.length || payloads.length !== toolNames.length) return null;
  const aggregate = aggregateCoverage(payloads);
  const claims: FloGroundedAnswer["claims"] = [];
  const sentences: string[] = [];
  const usedSources = new Map<string, FloSourceRef>();
  const useSource = (source: FloSourceRef | null) => {
    if (source) usedSources.set(source.id, source);
    return source;
  };
  const addClaim = (kind: FloGroundedAnswer["claims"][number]["kind"], label: string, field: string, value: string, source: FloSourceRef | null) => {
    if (!source) return false;
    useSource(source);
    claims.push({ kind, label, field, value, evidenceIds: [source.id] });
    return true;
  };

  const accounts = directPayload(toolNames, payloads, "getAccountOverview");
  const bills = directPayload(toolNames, payloads, "getBillsAndDebt");
  const income = directPayload(toolNames, payloads, "getIncomeSchedule");
  const activity = directPayload(toolNames, payloads, "searchTransactions");
  const budgetsAndGoals = directPayload(toolNames, payloads, "getBudgetsAndGoals");
  const debtPlanHistory = directPayload(toolNames, payloads, "getDebtPlanHistory");
  const settings = directPayload(toolNames, payloads, "getHouseholdAndSettings");
  const connections = directPayload(toolNames, payloads, "getConnectionHealth");

  if (intent === "forecast_overview") {
    sentences.push("I checked the current records feeding your Forecast.");
    const accountSummary = accounts?.summary as Record<string, unknown> | undefined;
    const accountSource = useSource(sourceForRecord(accounts, "summary"));
    const checking = directCurrency(accountSummary?.checkingBalance);
    if (checking && addClaim("amount", "Checking balance", "checkingBalance", checking, accountSource)) sentences.push(`Your verified checking balance is ${checking}.`);

    const billSummary = bills?.summary as Record<string, unknown> | undefined;
    const billSummarySource = useSource(sourceForRecord(bills, "summary"));
    const billCount = money(billSummary?.billRecordCount);
    const debtCount = money(billSummary?.activeDebtCount);
    const countParts: string[] = [];
    if (billCount !== null && addClaim("count", "Bill and debt records", "billRecordCount", String(billCount), billSummarySource)) countParts.push(`${billCount} bill and debt record${billCount === 1 ? "" : "s"}`);
    if (debtCount !== null && addClaim("count", "Active debts", "activeDebtCount", String(debtCount), billSummarySource)) countParts.push(`${debtCount} active debt${debtCount === 1 ? "" : "s"}`);
    if (countParts.length) sentences.push(`The plan currently includes ${countParts.join(" and ")}.`);

    const settingsRow = (settings?.records as Array<Record<string, unknown>> | undefined)?.find(record => record.id === "settings");
    const settingsSource = useSource(sourceForRecord(settings, "settings"));
    const safetyFloor = directCurrency(settingsRow?.safety_floor);
    if (safetyFloor && addClaim("amount", "Safety floor", "safety_floor", safetyFloor, settingsSource)) sentences.push(`Your safety floor is ${safetyFloor}.`);

    const upcoming: Array<Record<string, unknown> & { recordType: string; date: unknown }> = [
      ...((income?.records as Array<Record<string, unknown>> | undefined) ?? []).map(record => ({ ...record, recordType: "income", date: record.next_payment_date })),
      ...((bills?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => record.id !== "summary").map(record => ({ ...record, recordType: "bill", date: record.next_payment_date })),
    ].filter(record => isDateOnly(record.date)).sort((left, right) => String(left.date).localeCompare(String(right.date))).slice(0, 2);
    const upcomingText: string[] = [];
    for (const record of upcoming) {
      const payload = record.recordType === "income" ? income : bills;
      const source = useSource(sourceForRecord(payload, record.id));
      const name = String(record.name ?? record.recordType).trim().slice(0, 100);
      const amount = directCurrency(record.amount);
      const date = String(record.date);
      if (!source || !amount) continue;
      addClaim("entity", "Scheduled item", "name", name, source);
      addClaim("amount", "Scheduled amount", "amount", amount, source);
      addClaim("date", "Scheduled date", "next_payment_date", date, source);
      upcomingText.push(`${name} ${amount} on ${date}`);
    }
    if (upcomingText.length) sentences.push(`Next on the schedule: ${upcomingText.join("; ")}.`);
    sentences.push("Open Forecast to review the exact daily projected closes and every calendar item.");
  } else if (intent === "account_overview") {
    const rows = ((accounts?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => record.record_kind !== "canonical_account_summary").slice(0, 5);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(accounts, record.id));
      const name = String(record.display_name ?? record.name ?? record.official_name ?? "Account").trim().slice(0, 100);
      const balance = directCurrency(record.current_balance);
      if (!source || !balance) continue;
      addClaim("entity", "Account", record.display_name ? "display_name" : record.name ? "name" : "official_name", name, source);
      addClaim("amount", "Current balance", "current_balance", balance, source);
      items.push(`${name}: ${balance}`);
    }
    sentences.push(items.length ? `Your verified active account balances are ${items.join("; ")}.` : "I checked your active accounts, but no current balance was available to list.");
  } else if (intent === "bill_overview") {
    const rows = ((bills?.records as Array<Record<string, unknown>> | undefined) ?? [])
      .filter(record => record.id !== "summary" && record.is_debt !== true)
      .slice(0, 4);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(bills, record.id));
      const name = String(record.name ?? "Bill").trim().slice(0, 100);
      const amount = directCurrency(record.amount);
      const frequency = typeof record.frequency === "string" && record.frequency.trim()
        ? record.frequency.trim().slice(0, 40)
        : null;
      if (!source || !amount) continue;
      addClaim("entity", "Bill", "name", name, source);
      addClaim("amount", "Configured amount", "amount", amount, source);
      if (frequency) addClaim("status", "Frequency", "frequency", frequency, source);
      items.push(`${name}: ${amount}${frequency ? ` ${frequency}` : ""}`);
    }
    sentences.push(items.length ? `Your verified configured bills include ${items.join("; ")}.` : "I checked your configured bills, but no active bill record was available to list.");
  } else if (intent === "debt_overview") {
    const summary = bills?.summary as Record<string, unknown> | undefined;
    const summarySource = useSource(sourceForRecord(bills, "summary"));
    const total = directCurrency(summary?.debtBalance);
    const count = money(summary?.activeDebtCount);
    if (total && count !== null) {
      addClaim("amount", "Debt balance", "debtBalance", total, summarySource);
      addClaim("count", "Active debt count", "activeDebtCount", String(count), summarySource);
      sentences.push(`Your verified active debt balance is ${total} across ${count} debt${count === 1 ? "" : "s"}.`);
    } else sentences.push("I checked your active debts, but a complete debt total was not available.");
    const rows = ((bills?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => record.id !== "summary" && record.is_debt === true).slice(0, 3);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(bills, record.id));
      const name = String(record.name ?? "Debt").trim().slice(0, 100);
      const balance = directCurrency(record.balance);
      if (!source || !balance) continue;
      addClaim("entity", "Debt", "name", name, source);
      addClaim("amount", "Debt balance", "balance", balance, source);
      items.push(`${name}: ${balance}`);
    }
    if (items.length) sentences.push(`Current balances: ${items.join("; ")}.`);
  } else if (intent === "debt_plan_history") {
    const rows = ((debtPlanHistory?.records as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 4);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(debtPlanHistory, record.id));
      const amount = directCurrency(record.amount);
      const date = isDateOnly(record.payment_date) ? String(record.payment_date) : null;
      if (!source || !amount) continue;
      addClaim("amount", "Planned extra payment", "amount", amount, source);
      if (date) addClaim("date", "Payment date", "payment_date", date, source);
      const period = date ?? "saved plan";
      items.push(`${amount} for ${period}`);
    }
    sentences.push(items.length ? `Your most recent verified saved debt plans are ${items.join("; ")}.` : "I checked your saved debt plans, but no plan history was available to list.");
    sentences.push("Open the Debt Payoff Planner to review every allocation.");
  } else if (intent === "income_overview") {
    const rows = ((income?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => isDateOnly(record.next_payment_date)).sort((left, right) => String(left.next_payment_date).localeCompare(String(right.next_payment_date))).slice(0, 3);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(income, record.id));
      const name = String(record.name ?? "Income").trim().slice(0, 100);
      const amount = directCurrency(record.amount);
      const date = String(record.next_payment_date);
      if (!source || !amount) continue;
      addClaim("entity", "Income", "name", name, source);
      addClaim("amount", "Income amount", "amount", amount, source);
      addClaim("date", "Next payment date", "next_payment_date", date, source);
      items.push(`${name}: ${amount} on ${date}`);
    }
    sentences.push(items.length ? `Your next verified income dates are ${items.join("; ")}.` : "I checked your income schedule, but no next payment date was available.");
  } else if (intent === "activity_overview") {
    const summary = activity?.summary as Record<string, unknown> | undefined;
    const summarySource = useSource(sourceForRecord(activity, "summary"));
    const outflows = directCurrency(summary?.outflows);
    const transactionCount = money(summary?.transactionCount);
    if (outflows && transactionCount !== null) {
      addClaim("amount", "Outflows", "outflows", outflows, summarySource);
      addClaim("count", "Transaction count", "transactionCount", String(transactionCount), summarySource);
      sentences.push(`The verified Activity range includes ${transactionCount} cash transaction${transactionCount === 1 ? "" : "s"} and ${outflows} in outflows.`);
    }
    const rows = ((activity?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => record.id !== "summary").slice(0, 3);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(activity, record.id));
      const name = String(record.merchant_name ?? record.note ?? record.category ?? "Activity").trim().slice(0, 100);
      const amount = directCurrency(record.amount);
      const date = String(record.date ?? "");
      if (!source || !amount || !isDateOnly(date)) continue;
      const nameField = record.merchant_name ? "merchant_name" : record.note ? "note" : "category";
      addClaim("entity", "Activity", nameField, name, source);
      addClaim("amount", "Activity amount", "amount", amount, source);
      addClaim("date", "Activity date", "date", date, source);
      items.push(`${name}: ${amount} on ${date}`);
      if (claims.length >= 12) break;
    }
    if (items.length) sentences.push(`Recent records: ${items.join("; ")}.`);
    if (!sentences.length) sentences.push("I checked Activity, but no matching cash transactions were available to list.");
  } else if (intent === "budget_goal_overview") {
    const rows = (budgetsAndGoals?.records as Array<Record<string, unknown>> | undefined) ?? [];
    const budgetItems: string[] = [];
    for (const record of rows.filter(record => record.record_kind === "budget").slice(0, 2)) {
      const source = useSource(sourceForRecord(budgetsAndGoals, record.id));
      const category = String(record.category ?? "Budget").trim().slice(0, 100);
      const amount = directCurrency(record.amount);
      if (!source || !amount) continue;
      addClaim("entity", "Budget category", "category", category, source);
      addClaim("amount", "Budget amount", "amount", amount, source);
      budgetItems.push(`${category}: ${amount}`);
    }
    if (budgetItems.length) sentences.push(`Current verified budgets include ${budgetItems.join("; ")}.`);
    const goalItems: string[] = [];
    for (const record of rows.filter(record => record.record_kind === "goal").slice(0, 2)) {
      const source = useSource(sourceForRecord(budgetsAndGoals, record.id));
      const name = String(record.name ?? "Goal").trim().slice(0, 100);
      const current = directCurrency(record.current_amount);
      const target = directCurrency(record.target_amount);
      if (!source || !current || !target) continue;
      addClaim("entity", "Goal", "name", name, source);
      addClaim("amount", "Goal current amount", "current_amount", current, source);
      addClaim("amount", "Goal target", "target_amount", target, source);
      goalItems.push(`${name}: ${current} toward ${target}`);
    }
    if (goalItems.length) sentences.push(`Open goals: ${goalItems.join("; ")}.`);
    if (!sentences.length) sentences.push("I checked budgets and goals, but no open records were available to list.");
  } else {
    const rows = ((connections?.records as Array<Record<string, unknown>> | undefined) ?? []).filter(record => record.record_kind === "connection").slice(0, 4);
    const items: string[] = [];
    for (const record of rows) {
      const source = useSource(sourceForRecord(connections, record.id));
      const name = String(record.institution_name ?? "Bank connection").trim().slice(0, 100);
      const status = String(record.status ?? "unknown").trim().slice(0, 40);
      if (!source) continue;
      addClaim("entity", "Institution", "institution_name", name, source);
      addClaim("status", "Connection status", "status", status, source);
      items.push(`${name}: ${status}`);
    }
    sentences.push(items.length ? `Your verified bank connection status is ${items.join("; ")}.` : "I checked your connected accounts, but no bank connection status was available.");
  }

  if (!usedSources.size) payloads.flatMap(payload => payload.evidence).slice(0, 8).forEach(useSource);
  const sources = [...usedSources.values()];
  if (!sources.length) return null;
  const caveat = aggregate.partial
    ? "Some requested records were unavailable, incomplete, or missing a reliable freshness timestamp."
    : null;
  return {
    answer: { answer: sentences.join(" "), claims, caveat, evidenceIds: sources.map(source => source.id), followups: [] },
    sources,
    dataAsOf: aggregate.dataAsOf,
    coverage: aggregate.coverage,
    partial: aggregate.partial,
  };
}

export function verifiedFallbackForTool(
  question: string,
  toolName: string,
  payload: FloToolEnvelope,
): FloVerifiedFallback {
  const normalized = question.toLowerCase();
  const formatCurrency = (value: unknown) => {
    const parsed = money(value);
    return parsed === null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parsed);
  };
  const accountSummary = toolName === "getAccountOverview" && payload.summary && typeof payload.summary === "object"
    ? payload.summary as Record<string, unknown>
    : null;
  const accountRows = toolName === "getAccountOverview"
    ? (payload.records as Array<Record<string, unknown>>).filter(record => record.record_kind !== "canonical_account_summary")
    : [];
  const accountBalances = accountRows
    .map(record => {
      const balance = formatCurrency(record.current_balance);
      const name = String(record.display_name ?? record.name ?? record.official_name ?? "Account").trim();
      return balance ? `${name}: ${balance}` : null;
    })
    .filter((value): value is string => Boolean(value));
  const accountTotals = accountSummary
    ? [
        ["checking", formatCurrency(accountSummary.checkingBalance)],
        ["savings", formatCurrency(accountSummary.savingsBalance)],
        ["liabilities", formatCurrency(accountSummary.liabilities)],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => `${label}: ${value}`)
    : [];
  const verifiedAccountAnswer = payload.status === "unavailable"
    ? "I couldn't retrieve a verified account balance just now. Open Accounts to review the connection, or tap Retry."
    : accountBalances.length
    ? `I found ${accountBalances.length} active account${accountBalances.length === 1 ? "" : "s"}: ${accountBalances.join("; ")}.${accountTotals.length ? ` Verified totals — ${accountTotals.join(", ")}.` : ""}`
    : "I checked your active accounts. No verified account balance was available to list right now. Open Accounts to review the connection, or tap Retry.";
  const safeDebtQuestion = toolName === "getBillsAndDebt"
    && (/\b(?:safe|safely|afford|extra)\b.*\bdebt\b/.test(normalized) || /\bdebt\b.*\b(?:safe|safely|afford|extra)\b/.test(normalized));
  const routes: Record<string, { label: string; route: string; answer: string }> = {
    getAccountOverview: { label: "Accounts", route: "/(tabs)/more", answer: verifiedAccountAnswer },
    searchTransactions: { label: "Activity", route: "/(tabs)/transactions", answer: "I checked your recent Activity records, but the full explanation did not finish. Open Activity to review them, or tap Retry." },
    getBillsAndDebt: { label: "Bills and debt", route: "/(tabs)/bills", answer: "I checked your bills and debt records, but the full explanation did not finish. Open Bills to review them, or tap Retry." },
    getBillPlanDetails: { label: "Forecast", route: "/(tabs)/monthly", answer: "I checked the planned payment records, but the full explanation did not finish. Open Forecast to review the plan, or tap Retry." },
    getIncomeSchedule: { label: "Income", route: "/(tabs)/bills", answer: "I checked your income schedule, but the full explanation did not finish. Open Bills to review it, or tap Retry." },
    getBudgetsAndGoals: { label: "Budgets and goals", route: "/(tabs)/bills", answer: "I checked your budgets and goals, but the full explanation did not finish. Open Bills to review them, or tap Retry." },
    getDecisionsAndSimulations: { label: "Plan Simulator", route: "/plan-simulator", answer: "I checked your saved plans and simulations, but the full explanation did not finish. Open Plan Simulator to review them, or tap Retry." },
    getDebtPlanHistory: { label: "Debt Payoff Planner", route: "/snowball-plan", answer: "I checked your debt-plan history, but the full explanation did not finish. Open the Debt Payoff Planner to review it, or tap Retry." },
    getConnectionHealth: { label: "Connected accounts", route: "/(tabs)/more", answer: "I checked your connection records, but the full explanation did not finish. Open Accounts to review connection status, or tap Retry." },
    getHouseholdAndSettings: { label: "Settings", route: "/(tabs)/more", answer: "I checked your household settings, but the full explanation did not finish. Open Settings to review them, or tap Retry." },
    getFlowLedgerHelp: { label: "FlowLedger guide", route: "/(tabs)/more", answer: "I found the FlowLedger guidance, but the full explanation did not finish. Open Settings and the User Guide, or tap Retry." },
  };
  const destination = safeDebtQuestion
    ? { label: "Debt Payoff Planner", route: "/snowball-plan", answer: "The Debt Payoff Planner is the verified place to test a safe extra debt payment because it uses your full Forecast. Open the planner to preview the amount and date without changing your plan." }
    : routes[toolName] ?? { label: "FlowLedger", route: "/(tabs)/index", answer: "I checked the requested FlowLedger records, but the full explanation did not finish. Tap Retry to check again." };
  const sources = payload.evidence.length
    ? payload.evidence.slice(0, 12)
    : [helpSource(`recovery-${toolName}`, destination.label, destination.route)];
  if (!sources.some(source => source.route === destination.route)) {
    sources.push(helpSource(`recovery-${toolName}`, destination.label, destination.route));
  }
  return {
    answer: destination.answer,
    sources,
    dataAsOf: payload.dataAsOf,
    coverage: {
      complete: false,
      tools: 1,
      partialTools: payload.status === "ok" && payload.coverage.complete ? 0 : 1,
      exclusions: payload.coverage.exclusions ?? [],
      reasons: ["assistant_synthesis_unavailable", ...(payload.coverage.reason ? [payload.coverage.reason] : [])],
      dateRanges: payload.coverage.startDate || payload.coverage.endDate
        ? [{ startDate: payload.coverage.startDate, endDate: payload.coverage.endDate }]
        : [],
    },
    partial: true,
    caveat: payload.status !== "ok" || !payload.coverage.complete
      ? "Flo answered from the verified records that were available. Some records may still need a refresh."
      : "Flo verified the records, then used a reliable account answer because the full explanation needed more time.",
    followups: [],
  };
}

export function verifiedFallbackFromTools(
  question: string,
  toolNames: string[],
  payloads: FloToolEnvelope[],
): FloVerifiedFallback | null {
  if (!payloads.length || toolNames.length !== payloads.length) return null;
  const individual = payloads.map((payload, index) => verifiedFallbackForTool(question, toolNames[index], payload));
  const primary = individual[individual.length - 1];
  const combinedAnswer = Array.from(new Set(individual.map(item => item.answer))).join(" ");
  const sources = Array.from(new Map(individual.flatMap(item => item.sources).map(source => [source.id, source])).values()).slice(0, 40);
  const aggregate = aggregateCoverage(payloads);
  return {
    ...primary,
    answer: combinedAnswer,
    sources,
    dataAsOf: aggregate.dataAsOf,
    coverage: {
      ...aggregate.coverage,
      complete: false,
      reasons: Array.from(new Set(["assistant_synthesis_unavailable", ...(aggregate.coverage.reasons ?? [])])),
    },
    partial: true,
    caveat: payloads.some(payload => payload.status !== "ok" || !payload.coverage.complete)
      ? "Flo answered from the verified records that were available. Some records may still need a refresh."
      : "Flo verified the requested account sections, then used a reliable account answer because the full explanation needed more time.",
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function boundedLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(FLO_V3_MAX_ROWS, Math.floor(parsed)));
}

export function sanitizeContext(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const key of ["route", "entityType", "entityId", "date", "label"]) {
    const candidate = input[key];
    if (typeof candidate === "string" && candidate.trim()) output[key] = candidate.trim().slice(0, key === "label" ? 100 : 120);
  }
  return Object.keys(output).length ? output : undefined;
}

export function safeSearchTerm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[%_*,()]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || undefined;
}

export function money(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function freshness(asOf: unknown, now = Date.now()): FloSourceRef["freshness"] {
  const parsed = Date.parse(String(asOf ?? ""));
  if (!Number.isFinite(parsed)) return "unknown";
  return now - parsed <= 7 * 86_400_000 ? "current" : "stale";
}

function numericLeavesForClaim(value: unknown, field: string, output: number[]) {
  if (Array.isArray(value)) return value.forEach(item => numericLeavesForClaim(item, field, output));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === field && typeof item === "number" && Number.isFinite(item)) {
      const normalized = money(item); if (normalized !== null) output.push(normalized);
    }
    if (item && typeof item === "object") numericLeavesForClaim(item, field, output);
  }
}

function leafValuesAtField(value: unknown, field: string, output: unknown[]) {
  if (Array.isArray(value)) return value.forEach(item => leafValuesAtField(item, field, output));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === field && (typeof item === "string" || typeof item === "boolean")) output.push(item);
    if (item && typeof item === "object") leafValuesAtField(item, field, output);
  }
}

function recordMatchesSource(value: unknown, recordId: string): unknown[] {
  const matches: unknown[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const candidate = row.id ?? row.account_id ?? row.category ?? row.household_id;
    if (candidate != null && String(candidate) === recordId) matches.push(row);
    Object.values(row).forEach(visit);
  };
  visit(value);
  return matches;
}

export function validateGroundedAnswer(
  answer: FloGroundedAnswer,
  evidence: FloSourceRef[],
  toolPayloads: FloToolEnvelope[],
): { valid: boolean; code?: string } {
  if (!answer.answer.trim() || answer.answer.length > 4000) return { valid: false, code: "invalid_answer" };
  const knownIds = new Set(evidence.map(source => source.id));
  if (!answer.evidenceIds.length || answer.evidenceIds.some(id => !knownIds.has(id))) {
    return { valid: false, code: "unverified_evidence" };
  }
  if (answer.followups.length > 6 || answer.claims.length > 12) return { valid: false, code: "answer_too_large" };
  if (answer.followups.some(value => /[$%\d]|\b(?:afford|safe|healthy|dangerous|stable|unstable)\b/i.test(value))) return { valid: false, code: "unsafe_followup" };
  if (answer.claims.some(claim => !claim.evidenceIds.length || claim.evidenceIds.some(id => !knownIds.has(id)))) {
    return { valid: false, code: "unverified_claim" };
  }
  const sourceById = new Map(evidence.map(source => [source.id, source]));
  for (const claim of answer.claims) {
    const scopedRecords = claim.evidenceIds.flatMap(id => {
      const source = sourceById.get(id);
      if (!source?.recordId) return [];
      return toolPayloads
        .filter(payload => payload.evidence.some(item => item.id === id))
        .flatMap(payload => recordMatchesSource({ records: payload.records, summary: payload.summary }, source.recordId!));
    });
    const fieldLeaves: unknown[] = [];
    leafValuesAtField(scopedRecords, claim.field, fieldLeaves);
    if (!scopedRecords.length && !claim.evidenceIds.every(id => id.startsWith("policy:") || id.startsWith("help:"))) {
      return { valid: false, code: "evidence_record_missing" };
    }
    if (claim.kind === "amount" || claim.kind === "count") {
      const claimed = money(claim.value.replace(/[$,%]/g, "").replace(/,/g, ""));
      const supported: number[] = [];
      numericLeavesForClaim(scopedRecords, claim.field, supported);
      if (claimed === null || !supported.some(value => Math.abs(value - claimed) < 0.005)) return { valid: false, code: "unsupported_amount" };
    } else if (!claim.value.trim() || (!claim.evidenceIds.every(id => id.startsWith("policy:") || id.startsWith("help:")) && !fieldLeaves.some(value => String(value).trim().toLowerCase() === claim.value.trim().toLowerCase()))) {
      return { valid: false, code: "unsupported_claim" };
    }
  }
  const payloadText = JSON.stringify(toolPayloads.map(payload => ({ records: payload.records, summary: payload.summary, coverage: payload.coverage, evidence: payload.evidence }))).toLowerCase();

  const proseDates = Array.from(answer.answer.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(match => match[0].toLowerCase());
  if (proseDates.some(value => !payloadText.includes(value))) return { valid: false, code: "unsupported_date" };
  const claimNumbers = answer.claims.flatMap(claim => Array.from(claim.value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)))
    .map(match => Number(match[0].replace(/,/g, ""))).filter(Number.isFinite);
  const proseNumbers = Array.from(answer.answer.matchAll(/-?\d[\d,]*(?:\.\d+)?/g))
    .map(match => Number(match[0].replace(/,/g, ""))).filter(Number.isFinite);
  if (proseNumbers.some(value => !claimNumbers.some(claim => Math.abs(claim - value) < 0.0001))) return { valid: false, code: "unstructured_numeric_claim" };
  return { valid: true };
}

export function aggregateCoverage(payloads: FloToolEnvelope[]) {
  const partial = payloads.length === 0 || payloads.some(payload => payload.status !== "ok" || !payload.coverage.complete);
  const dates = payloads.map(payload => payload.dataAsOf ? Date.parse(payload.dataAsOf) : Number.NaN).filter(Number.isFinite);
  return {
    partial,
    dataAsOf: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    coverage: {
      complete: !partial,
      tools: payloads.length,
      partialTools: payloads.filter(payload => payload.status !== "ok" || !payload.coverage.complete).length,
      exclusions: Array.from(new Set(payloads.flatMap(payload => payload.coverage.exclusions ?? []))),
      reasons: Array.from(new Set(payloads.map(payload => payload.coverage.reason).filter((value): value is string => Boolean(value)))),
      dateRanges: payloads.filter(payload => payload.coverage.startDate || payload.coverage.endDate).map(payload => ({ startDate: payload.coverage.startDate, endDate: payload.coverage.endDate })),
    },
  };
}

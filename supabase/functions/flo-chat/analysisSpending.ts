import { dayAdd, dollars, label, matches, monthStart, numeric, requireSources, round, shiftMonth, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export type AnalyticTransaction = { id: string; date: string; amount: number; merchant: string; category: string; account: string; kind: "spending" | "income" | "refund" | "transfer" | "repayment" | "unresolved"; repaymentKind?: "card" | "loan" | "unknown"; billId?: string };
/** Stored Plaid amounts already use FlowLedger's sign convention. */
export function analyticTransactions(snapshot: AnalysisSnapshot): { rows: AnalyticTransaction[]; missing: string[] } {
  const source = (table: string) => snapshot.sources[table]?.rows ?? [];
  const accounts = source("plaid_accounts");
  const manual = source("transactions");
  const byProvider = new Map(source("plaid_transactions").map(r => [r.plaid_transaction_id, r]));
  const manualIds = new Set(manual.map(r => r.id));
  const providerIds = new Set(manual.map(r => r.plaid_transaction_id).filter(Boolean));
  const debts = new Set(source("bills").filter(r => r.is_debt).map(r => r.id));
  const imported = source("plaid_transactions").filter(r => !providerIds.has(r.plaid_transaction_id) && !manualIds.has(r.flowledger_transaction_id));
  const rows: AnalyticTransaction[] = [];
  const missing = requireSources(snapshot, ["transactions", "plaid_transactions", "plaid_accounts", "bills", "goals"]);
  for (const entry of [...manual.map(r => ({ r, bank: false })), ...imported.map(r => ({ r, bank: true }))]) {
    const { r, bank } = entry;
    if (r.pending || r.removed_at || r.deleted_at) continue;
    const bankRow = bank ? r : byProvider.get(r.plaid_transaction_id);
    const account = accounts.find(a => a.id === r.plaid_account_id || a.plaid_account_id === r.plaid_account_id || a.id === bankRow?.plaid_account_id);
    const credit = account?.account_type === "credit";
    const amount = numeric(r.amount);
    if (amount === null || !validDate(r.date ?? r.transaction_date)) { missing.push("Some transaction amounts or dates are invalid"); continue; }
    // A future-dated manual entry is a plan, not observed spending or income.
    if (String(r.date ?? r.transaction_date) > snapshot.today) continue;
    const category = String(r.category ?? bankRow?.category ?? "Other");
    const pfc = `${bankRow?.primary_category ?? ""} ${bankRow?.detailed_category ?? ""}`;
    const savingsGoal=r.linked_plan_type==="goal"&&source("goals").some(g=>g.id===r.linked_plan_id&&g.goal_type==="savings");
    const transfer = savingsGoal || r.review_resolution === "transfer" || r.review_status === "transfer" || Boolean(r.transfer_group_id) || /TRANSFER_(?:IN|OUT)_ACCOUNT_TRANSFER/.test(pfc);
    const cardRepayment = /CREDIT_CARD_PAYMENT|CREDIT CARD PAYMENT/i.test(`${category} ${pfc}`);
    const loanRepayment = /LOAN_PAYMENTS_(?:CAR|MORTGAGE|STUDENT|OTHER)_PAYMENT|^(?:Mortgage|Auto loan|Student loan)$/i.test(`${category} ${pfc}`.trim());
    const repayment = cardRepayment || loanRepayment || Boolean(r.linked_bill_id && debts.has(r.linked_bill_id));
    const income = Boolean(r.linked_income_id) || /^(income|paycheck|salary|wages)$/i.test(category) || /\bINCOME\b/.test(pfc);
    let kind: AnalyticTransaction["kind"] = transfer ? "transfer" : repayment ? "repayment" : r.review_status === "needs_review" ? "unresolved" : amount < 0 ? "spending" : credit ? "refund" : income ? "income" : /refund|reversal/i.test(`${category} ${pfc}`) ? "refund" : "unresolved";
    if ((bank || r.source === "plaid") && !account) kind = "unresolved";
    if(!transfer&&/TRANSFER_(?:IN|OUT)/.test(pfc))kind="unresolved";
    if(!transfer&&/^savings$/i.test(category))kind="unresolved";
    // Raw credit loan-payment credits are repayments, not merchant refunds.
    if (credit && amount > 0 && /LOAN_PAYMENTS/.test(pfc)) kind = "repayment";
    const base:AnalyticTransaction = { id: String(r.id), date: String(r.date ?? r.transaction_date), amount, merchant: label(r.merchant_name ?? r.note ?? r.name), category: label(category), account: label(account?.display_name ?? account?.name ?? r.account_id ?? "Manual"), kind, repaymentKind:repayment ? cardRepayment||credit ? "card" : loanRepayment ? "loan" : "unknown" : undefined, billId: r.linked_bill_id };
    const allocations = Array.isArray(r.review_allocations) ? r.review_allocations : [];
    if (kind === "spending" && allocations.length && Math.abs(sum(allocations.map((a: any) => Math.abs(numeric(a.amount) ?? NaN))) - Math.abs(amount)) < .005) {
      allocations.forEach((a: any, index: number) => rows.push({ ...base, id: `${base.id}:${index}`, amount: -Math.abs(Number(a.amount)), category: label(a.category ?? a.name ?? category), kind: a.type === "transfer" ? "transfer" : a.type === "extra_principal" || debts.has(a.targetId) ? "repayment" : "spending" }));
    } else if(kind === "spending" && allocations.length) {
      rows.push({...base,kind:"unresolved"});
      missing.push("A split transaction does not reconcile to its recorded amount");
    } else rows.push(base);
  }
  return { rows, missing: [...new Set(missing)] };
}

export function aggregateSpending(rows: AnalyticTransaction[], start: string, end: string) {
  const period = rows.filter(r => r.date >= start && r.date <= end);
  const spending = period.filter(r => r.kind === "spending" || r.kind === "refund");
  const group = (key: "category" | "merchant") => {
    const totals = new Map<string, number>();
    spending.forEach(r => totals.set(r[key], (totals.get(r[key]) ?? 0) - Math.round(r.amount * 100)));
    return [...totals].map(([name, value]) => ({ name, amount: value / 100 })).sort((a, b) => b.amount - a.amount);
  };
  return { start, end, spending: -sum(spending.map(r => r.amount)) || 0, income: sum(period.filter(r => r.kind === "income").map(r => r.amount)), repayments: -sum(period.filter(r => r.kind === "repayment" && r.amount < 0).map(r => r.amount)) || 0, nonCardRepayments:-sum(period.filter(r=>r.kind==="repayment"&&r.repaymentKind==="loan"&&r.amount<0).map(r=>r.amount))||0, unclassifiedDebt:period.filter(r=>r.kind==="repayment"&&(!r.repaymentKind||r.repaymentKind==="unknown")).length, unresolved: period.filter(r => r.kind === "unresolved").length, categories: group("category"), merchants: group("merchant"), rows: period };
}

export function spendingAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const all = analyticTransactions(snapshot);
  const start = request.startDate ?? monthStart(snapshot.today);
  const requestedEnd = request.endDate ?? snapshot.today;
  const end = requestedEnd < snapshot.today ? requestedEnd : snapshot.today;
  if(start>end)return {text:"That range is in the future. Recorded spending and received income can only be reviewed through today; ask for a forecast for future money.",facts:{},sources:["transactions","plaid_transactions"],assumptions:[],missing:["The requested range has no elapsed dates"],scenario:false};
  const filtered = all.rows.filter(r => matches(r.merchant, request.merchant ?? (request.domain === "transactions" ? request.entity : null)) && matches(r.category, request.category));
  const current = aggregateSpending(filtered, start, end);
  const missing = [...all.missing];
  if (current.unresolved) missing.push(`${current.unresolved} transactions need classification and are excluded from income/spending totals`);
  const facts: AnalysisResult["facts"] = { spending: current.spending, income: current.income, debtRepayments: current.repayments, startDate: start, endDate: end };
  const lines: string[] = [];
  if(request.domain==="income") {
    const received=current.rows.filter(r=>r.kind==="income"&&matches(r.merchant,request.entity));
    const total=sum(received.map(r=>r.amount));
    facts.income=total;facts.paycheckCount=received.length;facts.averagePaycheck=received.length?round(total/received.length):null;
    lines.push(`${dollars(total)} in confirmed recorded income from ${start} through ${end}${request.entity?` matching ${label(request.entity)}`:""}.`);
    if(received.length)lines.push(`Average recorded payment: ${dollars(total/received.length)} across ${received.length} payments. Most recent: ${received.sort((a,b)=>b.date.localeCompare(a.date))[0].date}.`);
    if(request.operation==="average") {
      const completeStart=monthStart(start)===start;const completeEnd=dayAdd(end,1).endsWith("-01");
      const months=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
      let covered=completeStart&&completeEnd&&months>0&&!current.unresolved&&!all.missing.length;
      for(let month=monthStart(start);month<=end;month=shiftMonth(month,1))if(!current.rows.some(r=>r.date.slice(0,7)===month.slice(0,7)))covered=false;
      if(covered){facts.averageMonthlyIncome=round(total/months);lines.push(`Average per calendar month in that recorded range: ${dollars(total/months)}.`);}
      else missing.push("Use complete calendar months for a normal monthly-income average");
    }
  } else if (request.domain === "transactions") {
    const found = current.rows.filter(r => request.amount === null || (request.operation === "threshold" ? Math.abs(r.amount) >= request.amount : Math.abs(Math.abs(r.amount) - request.amount) < .005)).sort((a, b) => b.date.localeCompare(a.date));
    lines.push(`${found.length} matching recorded transactions from ${start} through ${end}.`, ...found.slice(0, 8).map(r => `${r.date}: ${r.merchant}, ${dollars(r.amount)} (${r.category}).`));
    facts.matchCount = found.length;
    if (found.length > 8) lines.push("Showing the eight most recent matches. Narrow the dates to see more.");
  } else if (request.domain === "fees") {
    const fees = current.rows.filter(r => r.amount < 0 && /fee|overdraft|nsf/i.test(`${r.category} ${r.merchant}`));
    const total = -sum(fees.map(r => r.amount));
    lines.push(`${dollars(total)} in recorded fee-labeled charges from ${start} through ${end}.`, ...fees.slice(-5).map(r => `${r.date}: ${r.merchant}, ${dollars(-r.amount)} (${r.account}).`));
    facts.fees = total;
    lines.push("These are category/name matches, not confirmation that every fee was identified.");
  } else if (request.domain === "unusual") {
    const purchases = current.rows.filter(r => r.kind === "spending");
    const history = all.rows.filter(r => r.kind === "spending" && r.date < start && r.date >= dayAdd(start, -90));
    const median = (values: number[]) => { const sorted = [...values].sort((a,b)=>a-b); return sorted.length % 2 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1] + sorted[sorted.length/2])/2; };
    const unusual = purchases.filter(r => { const prior = history.filter(h => h.merchant === r.merchant).map(h => -h.amount); return prior.length >= 3 && -r.amount > median(prior) * 2; });
    const repeated = purchases.filter((r, i) => purchases.some((other, j) => j < i && other.date === r.date && other.merchant === r.merchant && other.amount === r.amount));
    lines.push(`${unusual.length} unusually large merchant charges and ${repeated.length} same-day repeated-charge patterns to review.`, ...[...unusual, ...repeated].slice(0, 6).map(r => `${r.date}: ${r.merchant}, ${dollars(-r.amount)}.`), "These patterns may be legitimate; they are not proof of duplicate billing or fraud.");
    facts.unusualCount = unusual.length; facts.repeatCount = repeated.length;
    if (history.length < 3) missing.push("Not enough earlier transactions for a reliable unusual-spending baseline");
  } else {
    lines.push(`${dollars(current.spending)} in recorded net spending from ${start} through ${end}.`);
    const merchantGroup=request.groupBy==="merchant"||Boolean(request.merchant);
    const group = merchantGroup ? current.merchants : current.categories;
    if (group.length) lines.push(`Largest ${merchantGroup ? "merchant totals" : "categories"}: ${group.slice(0, 4).map(x => `${x.name} ${dollars(x.amount)}`).join("; ")}.`);
    if (request.operation === "compare" || request.domain === "review") {
      const dayCount=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
      const calendarAligned=start===monthStart(start);
      const previousStart = request.comparisonStart ?? (calendarAligned?shiftMonth(start,-1):dayAdd(start,-dayCount));
      const previousEnd = request.comparisonEnd ?? (calendarAligned?dayAdd(previousStart,Math.min(dayCount,new Date(Date.UTC(Number(previousStart.slice(0,4)),Number(previousStart.slice(5,7)),0)).getUTCDate())-1):dayAdd(previousStart,dayCount-1));
      const previous = aggregateSpending(filtered, previousStart, previousEnd);
      if(previous.unresolved||current.unresolved||all.missing.length||!previous.rows.length) {
        missing.push("A spending increase/decrease cannot be established while either comparison period has unclassified or unavailable transactions");
        lines.push(`The comparison with ${previousStart}–${previousEnd} is unavailable until both periods are classified.`);
      } else {
      const difference = round(current.spending - previous.spending);
      facts.previousSpending = previous.spending; facts.spendingChange = difference;
      lines.push(`Compared with ${previousStart}–${previousEnd}, spending is ${dollars(Math.abs(difference))} ${difference > 0 ? "higher" : "lower"}.`);
      const categoryNames=[...new Set([...current.categories,...previous.categories].map(c=>c.name))];
      const changes = categoryNames.map(name => ({ name, difference: round((current.categories.find(c=>c.name===name)?.amount??0) - (previous.categories.find(p => p.name === name)?.amount ?? 0)) })).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference));
      lines.push(...changes.slice(0,3).map(c=>`${c.name}: ${c.difference >= 0 ? "+" : "−"}${dollars(Math.abs(c.difference))}.`));
      if (!previous.rows.length) missing.push("No earlier matching recorded transactions; the comparison is not proof of a complete prior month");
      }
    }
    if (request.domain === "review") lines.push(`Confirmed income: ${dollars(current.income)}. Recorded debt repayments: ${dollars(current.repayments)}. Payments alone do not establish the change in debt principal.`);
  }
  return { text: lines.join("\n\n"), facts, sources: ["transactions", "plaid_transactions", "plaid_accounts", "bills", "goals"], assumptions: ["Totals cover recorded posted history only. Own-account transfers, linked savings contributions and identified debt/card repayments are excluded from consumption spending; merchant refunds reduce spending. Debt repayments remain cash-flow obligations."], missing, scenario: false };
}

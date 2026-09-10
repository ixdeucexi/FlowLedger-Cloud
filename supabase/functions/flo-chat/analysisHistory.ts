import { dollars, label, numeric, requireSources, round, shiftMonth, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

const exact = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
type Observation = { id: string; date: string; balance: number; created: string };

/** Deltas between actual manual-account observations only. Never reconstruct
 * historical principal/savings by subtracting payments from today's balance. */
export function historyAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const sources = ["accounts", "account_balances", "plaid_accounts"];
  const assumptions = ["Only retained manual-account balance observations are compared. Current balances, bank balances, goals and payment totals are not added to this history.", "Account grouping uses the retained account's current type; deleted accounts and changes in classification may limit historical household coverage."];
  const missing: string[] = [];
  const result = (text: string, facts: AnalysisResult["facts"] = {}): AnalysisResult => ({text, facts, sources, assumptions, missing:[...new Set(missing)], scenario:false});
  const unavailable = (reason: string) => { missing.push(reason); return result(reason,{historyStatus:"unavailable"}); };
  if (request.domain === "debt" || request.domain === "credit") {
    return unavailable("Historical debt-principal balances are not available in the recorded history. Repayments, current debt balances and saved projections do not establish how much principal changed.");
  }
  const start = request.startDate ?? shiftMonth(snapshot.today,-3);
  const end = request.endDate ?? snapshot.today;
  if (!validDate(start) || !validDate(end) || start >= end || end > snapshot.today || request.scenario) return unavailable("Choose a historical date range with two different dates, ending today or earlier. This tool does not project balances.");
  missing.push(...requireSources(snapshot,sources));
  if (missing.length) return unavailable("The recorded account history could not be fully checked; no historical balance change can be confirmed.");
  const rows = (table:string) => snapshot.sources[table]?.rows ?? [];
  const entity = exact(request.entity);
  const bankMatches = rows("plaid_accounts").filter(row => entity && [row.name,row.display_name,row.official_name].some(name=>exact(name)===entity));
  const manual = rows("accounts").filter(row => ["checking","savings","cash"].includes(row.account_type));
  const selected = entity ? manual.filter(row=>exact(row.name)===entity) : manual.filter(row=>request.domain === "savings" ? row.account_type === "savings" : ["checking","cash"].includes(row.account_type));
  if (entity && (selected.length + bankMatches.length !== 1)) return unavailable("That name does not identify exactly one retained account. Use a unique full account name; account and savings-goal histories are different.");
  if (entity && bankMatches.length) return unavailable("Dated connected-bank balance history is unavailable. Its current balance cannot be substituted for historical observations.");
  if (!selected.length) return unavailable("No retained manual accounts match this historical scope. Missing account history is not a zero balance.");
  const selectedIds = new Set(selected.map(row=>String(row.id)));
  const raw = rows("account_balances").filter(row=>selectedIds.has(String(row.account_id)));
  if (raw.some(row=>row.household_id!==snapshot.householdId)) return unavailable("Account history scope could not be verified.");
  // A malformed date cannot safely be assigned to or excluded from the window.
  if (raw.some(row=>!validDate(row.as_of_date))) return unavailable("A selected account has an invalid historical observation date.");
  const inWindow = raw.filter(row=>row.as_of_date>=start&&row.as_of_date<=end);
  if (inWindow.some(row=>numeric(row.balance)===null || typeof row.created_at!=="string" || !Number.isFinite(Date.parse(row.created_at)))) return unavailable("A selected historical balance or observation timestamp is invalid; it cannot be treated as zero.");
  const pairs: {name:string;first:Observation;last:Observation;count:number}[] = [];
  for (const account of selected) {
    const byDate = new Map<string,Observation>();
    for (const row of inWindow.filter(row=>String(row.account_id)===String(account.id))) {
      const candidate = {id:String(row.id),date:String(row.as_of_date),balance:Number(row.balance),created:String(row.created_at)};
      const prior = byDate.get(candidate.date);
      if (prior && Date.parse(candidate.created)===Date.parse(prior.created) && candidate.balance!==prior.balance) return unavailable("Conflicting same-time balance observations need review before historical change can be calculated.");
      if (!prior || Date.parse(candidate.created)>Date.parse(prior.created) || (candidate.created===prior.created&&candidate.id>prior.id)) byDate.set(candidate.date,candidate);
    }
    const observations = [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
    if (observations.length<2) return unavailable(`${label(account.name)} needs at least two dated balance observations inside ${start} through ${end}. Current balances and observations outside this range are not substituted.`);
    pairs.push({name:label(account.name),first:observations[0],last:observations[observations.length-1],count:observations.length});
  }
  const firstDates = new Set(pairs.map(pair=>pair.first.date));
  const lastDates = new Set(pairs.map(pair=>pair.last.date));
  const coherent = firstDates.size===1&&lastDates.size===1;
  const exactWindow = coherent&&pairs[0].first.date===start&&pairs[0].last.date===end;
  const details = pairs.map(pair=>`${pair.name}: ${dollars(pair.first.balance)} on ${pair.first.date} to ${dollars(pair.last.balance)} on ${pair.last.date}; observed change ${dollars(round(pair.last.balance-pair.first.balance))} (${pair.count} observed days).`).join("\n\n");
  const facts: AnalysisResult["facts"] = {historyStatus:exactWindow?"observed_endpoints":"partial_window",requestedStartDate:start,requestedEndDate:end,accountCount:pairs.length,observedStartDate:coherent?pairs[0].first.date:null,observedEndDate:coherent?pairs[0].last.date:null,observedStartingBalance:coherent?sum(pairs.map(pair=>pair.first.balance)):null,observedEndingBalance:coherent?sum(pairs.map(pair=>pair.last.balance)):null,observedBalanceChange:coherent?round(sum(pairs.map(pair=>pair.last.balance))-sum(pairs.map(pair=>pair.first.balance))):null};
  if (!exactWindow) missing.push(coherent?"Observations do not cover both requested endpoints; the reported change covers only the displayed observed dates":"Accounts have different observation endpoints; no combined balance change is reported");
  const hasBankGroup = !entity&&rows("plaid_accounts").some(row=>row.is_active===true&&row.account_subtype===(request.domain==="savings"?"savings":"checking"));
  if (hasBankGroup) missing.push("Connected-bank historical balances are unavailable; this manual-account comparison is not the total household change");
  return result(`Observed manual-account history, requested ${start} through ${end}:\n\n${details}\n\n${exactWindow?"The displayed observations cover the requested endpoints, not every intervening day.":"These are the actual observed dates; no missing dates were filled or extrapolated."} This does not establish income earned, debt reduced or savings contributions.`,facts);
}

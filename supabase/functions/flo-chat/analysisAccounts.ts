import { canonicalConnectedAccounts } from "../../../artifacts/mobile/lib/plaidActivity.ts";
import { dollars, label, localDay, numeric, requireSources, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

type BalanceRow = { id: string; name: string; aliases: string[]; kind: string; balance: number | null; date: string | null; connected: boolean };
const normalize = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Observations only: no forecast, available-funds or affordability inference. */
export function currentBalanceAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const sources = ["accounts", "plaid_accounts"];
  const missing = requireSources(snapshot, sources);
  const assumptions = ["These are recorded balance observations, not live bank funds or safe-to-spend amounts. Pending transactions and future obligations are not deducted here."];
  const unavailable = (reason: string): AnalysisResult => ({text: reason, facts: {}, sources, assumptions, missing: [...new Set([...missing, reason])], scenario: false});
  if (request.scenario || request.dateEvent !== "none" || [request.startDate, request.endDate].some(date => date !== null && date !== snapshot.today) || !["summary", "detail", "search"].includes(request.operation)) {
    return unavailable("This account tool can report the latest recorded balance only. Account-specific historical or future balances are unavailable; the household forecast must not be substituted for a named account.");
  }
  if (missing.length) return unavailable("I could not fully check the recorded accounts, so I cannot confirm this balance.");
  const rows = (name: string) => snapshot.sources[name]?.rows ?? [];
  const manual: BalanceRow[] = rows("accounts").filter(row => row.is_active === true && ["checking", "cash", "savings"].includes(row.account_type)).map(row => ({id:String(row.id), name:label(row.name), aliases:[normalize(row.name)], kind:row.account_type, balance:numeric(row.current_balance), date:validDate(row.balance_as_of) ? row.balance_as_of : null, connected:false}));
  const connected: BalanceRow[] = canonicalConnectedAccounts<Record<string, any> & {id:string;is_active:boolean}>(rows("plaid_accounts").map(row => ({...row,id:String(row.id),is_active:row.is_active === true}))).filter(row => ["checking", "savings"].includes(String(row.account_subtype))).map(row => {
    let date: string | null = null;
    if (typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))) {
      try { date = localDay(row.updated_at, snapshot.timeZone); } catch { /* Missing observation is explicit below. */ }
    }
    return {id:String(row.id), name:label(row.display_name || row.name), aliases:[row.display_name,row.name,row.official_name].map(normalize).filter(Boolean), kind:String(row.account_subtype), balance:numeric(row.current_balance), date, connected:true};
  });
  const entity = normalize(request.entity);
  let selected: BalanceRow[];
  if (entity) {
    selected = [...connected, ...manual].filter(row => row.aliases.includes(entity));
    if (selected.length !== 1) return unavailable(selected.length ? "That name matches more than one active account. Give the account a unique display name before asking for its balance." : "No active checking, cash or savings account exactly matches that name. Please use its full recorded name.");
  } else {
    const savings = request.domain === "savings";
    const bank = connected.filter(row => row.kind === (savings ? "savings" : "checking"));
    selected = bank.length ? bank : manual.filter(row => savings ? row.kind === "savings" : ["checking", "cash"].includes(row.kind));
    assumptions.push("For household totals, connected balances take precedence over manual balances of the same planning group, matching the app; savings are kept separate from checking/cash.");
    if (!selected.length && !savings) {
      sources.push("household_settings");
      missing.push(...requireSources(snapshot, ["household_settings"]));
      const settings = rows("household_settings")[0];
      if (settings && !missing.length) selected = [{id:"starting-balance",name:"Configured checking/cash starting balance",aliases:[],kind:"checking",balance:numeric(settings.starting_balance),date:validDate(settings.starting_balance_date) ? settings.starting_balance_date : null,connected:false}];
    }
    if (!selected.length) return unavailable("No recorded active balance is available for this account group; an absent balance is not zero.");
  }
  if (selected.some(row => row.balance === null)) return unavailable("A selected account has a missing or invalid balance. I cannot treat it as zero or return a partial total.");
  if (selected.some(row => !row.date || row.date > snapshot.today)) return unavailable("A selected account has a missing, invalid or future balance observation date. Reconcile or refresh it before using the balance.");
  const dates = [...new Set(selected.map(row => row.date!))].sort();
  const total = sum(selected.map(row => row.balance!));
  const scope = entity ? selected[0].name : request.domain === "savings" ? "Savings" : "Checking/cash";
  const dated = dates.length === 1 ? `as of ${dates[0]}` : `from observations dated ${dates[0]} through ${dates[dates.length-1]} (not one simultaneous balance)`;
  const detail = selected.length > 1 ? `\n\n${selected.map(row => `${row.name}: ${dollars(row.balance!)} as of ${row.date}.`).join("\n")}` : "";
  return {text:`${scope}: ${dollars(total)} recorded ${dated}.${detail}\n\nThis is not a live available-funds or safe-to-spend amount.`, facts:{recordedBalance:total,accountCount:selected.length,accountName:entity?selected[0].name:null,accountType:entity?selected[0].kind:request.domain === "savings"?"savings":"checking/cash",balanceAsOf:dates.length===1?dates[0]:null,oldestObservationDate:dates[0],newestObservationDate:dates[dates.length-1],safeToSpend:null},sources,assumptions,missing,scenario:false};
}

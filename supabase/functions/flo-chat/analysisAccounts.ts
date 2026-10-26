import { canonicalConnectedAccounts } from "../../../artifacts/mobile/lib/plaidActivity.ts";
import { dollars, label, localDay, numeric, requireSources, sum, validDate, type AnalysisRequest, type AnalysisResult, type AnalysisSnapshot } from "./analysisTypes.ts";

export type AccountIdentity = { id: string; name: string; aliases: string[] };
type BalanceRow = AccountIdentity & { kind: string; balance: number | null; date: string | null; connected: boolean; configuredDebt?: boolean; identityKnown?: boolean };
/** Punctuation and whitespace are interchangeable, but digits and whole words
 * remain significant. Never use edit distance or a substring of a token. */
export const normalizeAccountName = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function resolveAccountName<T extends AccountIdentity>(accounts: readonly T[], name: string): { selected: T | null; candidates: T[] } {
  const query = normalizeAccountName(name);
  if (!query) return { selected: null, candidates: [] };
  const exact = accounts.filter(row => row.aliases.some(alias => normalizeAccountName(alias) === query));
  const tokens = query.split(" ");
  const candidates = exact.length ? exact : accounts.filter(row => row.aliases.some(alias => {
    const words = normalizeAccountName(alias).split(" ");
    return tokens.every(token => words.includes(token));
  }));
  return { selected: candidates.length === 1 ? candidates[0] : null, candidates };
}

/** A number immediately attached to the user's account phrase is part of
 * that reference. Currency, decimals, percentages and dated phrases are not
 * interpreted as account suffixes. Unrecognized phrasing asks for confirmation. */
export function omittedAccountNumber(question: string, entity: string): boolean {
  const words = question.normalize("NFKC").toLowerCase().replace(/\bno\.(?=\s*\d)/g, "number ").replace(/[^\p{L}\p{N}$.,%]+/gu, " ").trim().split(/\s+/).map(word => word.replace(/^[.,]+|[.,]+$/g, ""));
  const name = normalizeAccountName(entity).split(" ");
  return words.some((_, index) => {
    if (!name.every((token, offset) => words[index + offset] === token)) return false;
    const marker = /^(?:account|number|no)$/;
    let suffix = index + name.length;
    for (let skipped = 0; skipped < 4 && marker.test(words[suffix] ?? ""); skipped++) suffix++;
    // A longer unsupported marker chain is unclear, never permission to drop
    // its remaining words and choose an account with a different number.
    if (marker.test(words[suffix] ?? "")) return true;
    const following = words[suffix], after = words[suffix + 1], previous = words[index - 1], before = words[index - 2];
    const month = /^(?:january|february|march|april|may|june|july|august|september|october|november|december)$/i;
    const number = (value: string | undefined) => /^\d+$/.test(value ?? "");
    return number(following) && !number(after) && !month.test(after ?? "") || number(previous) && !number(before) && !month.test(before ?? "");
  });
}

function liabilitySign(balance: number, configured = false) {
  if (balance > 0) return { status: "amount_owed", owed: balance, credit: 0, text: "This is recorded debt owed, not cash available to spend." };
  if (balance === 0) return { status: "no_amount_owed", owed: 0, credit: 0, text: "No amount is recorded as owed on this account. A zero liability is not spendable cash." };
  if (configured) return { status: "negative_configured_balance_unverified", owed: null, credit: null, text: "The configured debt-plan balance is negative; its meaning needs review. It does not establish an amount owed, an issuer credit or spendable cash." };
  return { status: "account_credit", owed: 0, credit: Math.abs(balance), text: `This is a recorded account credit/overpayment of ${dollars(Math.abs(balance))}, not an amount owed or spendable cash. Confirm its treatment with the issuer.` };
}

/** Full inventory identities and balance observations, not planning totals. */
export function recordedAccountRows(snapshot: AnalysisSnapshot): BalanceRow[] {
  const manual = (snapshot.sources.accounts?.rows ?? []).filter(row => row.is_active === true).map(row => ({
    id: String(row.id), name: label(row.name), aliases: [String(row.name ?? "")], kind: String(row.account_type || "unknown"),
    balance: numeric(row.current_balance), date: validDate(row.balance_as_of) ? row.balance_as_of : null, connected: false,
    identityKnown: typeof row.id === "string" && Boolean(row.id.trim()) && typeof row.name === "string" && Boolean(row.name.trim()),
  }));
  const connected = canonicalConnectedAccounts<Record<string, any> & { id: string; is_active: boolean }>(
    (snapshot.sources.plaid_accounts?.rows ?? []).map(row => ({ ...row, id: String(row.id), is_active: row.is_active === true, identityKnown: typeof row.id === "string" && Boolean(row.id.trim()) })),
  ).map(row => {
    let date: string | null = null;
    if (typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))) {
      try { date = localDay(row.updated_at, snapshot.timeZone); } catch { /* Unknown observation stays explicit. */ }
    }
    const kind = row.account_type === "credit" ? "credit" : String(row.account_subtype || row.account_type || "unknown");
    return { id: String(row.id), name: label(row.display_name || row.name), aliases: [row.display_name, row.name, row.official_name].filter((value): value is string => typeof value === "string" && Boolean(value.trim())), kind, balance: numeric(row.current_balance), date, connected: true, identityKnown: row.identityKnown === true && [row.display_name, row.name].some(value => typeof value === "string" && Boolean(value.trim())) };
  });
  return [...manual, ...connected];
}

export type AccountReferenceProvenance = { householdId: string; userPhrase: string; accountId: string; source: "manual" | "connected" | "configured_debt"; accountName: string };
const referenceSource = (row: BalanceRow) => row.configuredDebt ? "configured_debt" : row.connected ? "connected" : "manual";
export function isCurrentAccountReferenceQuestion(question: string): boolean {
  const q = normalizeAccountName(question);
  return /^(?:what is|what s|show me) (?:that (?:account|card|one)(?: s)?|the same (?:account|card)(?: s)?|its|it s) balance(?: now| today| right now)?$/.test(q)
    || /^how much(?: money)? is (?:in|sitting in) (?:that|the same) (?:account|card)(?: now| today)?$/.test(q)
    || /^what about (?:that|the same) (?:account|card|one)(?: now| today)?$/.test(q)
    || /^and (?:that|the same) (?:account|card|one)$/.test(q);
}
export function recordedBalanceTargets(snapshot: AnalysisSnapshot): BalanceRow[] {
  const debts: BalanceRow[] = (snapshot.sources.bills?.rows ?? []).filter(row => row.is_debt === true && (!row.end_date || row.end_date >= snapshot.today)).map(row => {
    let date: string | null = null;
    if (typeof row.last_reviewed_at === "string" && Number.isFinite(Date.parse(row.last_reviewed_at))) {
      try { date = localDay(row.last_reviewed_at, snapshot.timeZone); } catch { /* No invented date. */ }
    }
    return { id: String(row.id), name: label(row.name), aliases: [String(row.name ?? "")], kind: "configured debt", balance: numeric(row.balance), date, connected: false, configuredDebt: true };
  });
  return [...recordedAccountRows(snapshot), ...debts];
}
/** Only prior USER references can identify the target. Assistant amounts and
 * names are not evidence. Every candidate is resolved from the current snapshot. */
export function resolvePriorAccountReference(snapshot: AnalysisSnapshot, prior: readonly { question: string; phrase: string | null }[]): { reference?: AccountReferenceProvenance; clarification?: AnalysisResult } {
  const sources = ["accounts", "plaid_accounts", "bills"], missing = requireSources(snapshot, sources);
  const clarify = (reason: string) => ({ clarification: { text: reason, facts: {}, sources, assumptions: [], missing: [...missing, reason], scenario: false } });
  if (missing.length) return clarify("I could not verify the current account names. Please retry or name the account explicitly.");
  for (const turn of [...prior].reverse()) {
    if (isCurrentAccountReferenceQuestion(turn.question) || /^(?:thanks|thank you|ok|okay|got it|understood|great|appreciate it)$/.test(normalizeAccountName(turn.question))) continue;
    if (!turn.phrase) break;
    const resolved = resolveAccountName(recordedBalanceTargets(snapshot), turn.phrase);
    if (!resolved.selected) return clarify(resolved.candidates.length ? `Which account do you mean: ${accountChoices(resolved.candidates)}? The earlier name was ambiguous.` : "The earlier named account no longer identifies one active saved record. Please name the account you mean.");
    const account = resolved.selected;
    return { reference: { householdId: snapshot.householdId, userPhrase: turn.phrase, accountId: account.id, accountName: account.name, source: referenceSource(account) } };
  }
  return clarify("Which saved account do you mean? Please name it; this conversation has no unique account reference I can verify.");
}

const accountChoices = (rows: readonly BalanceRow[]) => rows.map(row => `${row.name} (${row.connected ? "connected" : "manual"} ${row.kind})`).join("; ");

export function accountInventoryAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest): AnalysisResult {
  const sources = ["accounts", "plaid_accounts"];
  const assumptions = ["This inventory lists recorded accounts, not live available funds or safe-to-spend amounts. Credit liabilities are separate from cash and are never added to a cash total.", "Connected balances take precedence over manual balances in the same checking/cash or savings planning group. Excluded manual identities remain visible here; this is not proof they are duplicate real accounts."];
  const missing = requireSources(snapshot, sources);
  const unavailable = (reason: string): AnalysisResult => ({ text: reason, facts: {}, sources, assumptions, missing: [...new Set([...missing, reason])], scenario: false });
  if (request.domain !== "money" || request.operation !== "detail" || request.entity || request.accountGroup || request.scenario || request.dateEvent !== "none" || [request.startDate, request.endDate, request.comparisonStart, request.comparisonEnd].some(date => date != null)) return unavailable("Account inventory lists currently recorded accounts only; it does not answer a named, historical, future or hypothetical balance request.");
  const rows = recordedAccountRows(snapshot);
  const bankGroups = new Set(rows.filter(row => row.connected).map(row => row.kind));
  const facts: AnalysisResult["facts"] = { accountCount: rows.length, inventoryComplete: missing.length === 0, safeToSpend: null };
  const lines = rows.map((row, index) => {
    const credit = ["credit", "credit_card"].includes(row.kind);
    const group = row.kind === "checking" || !row.connected && row.kind === "cash" ? "checking" : row.kind === "savings" ? "savings" : null;
    const planning = credit ? "Credit liability; excluded from cash planning totals" : !group ? "Outside checking/cash and savings planning totals" : !row.connected && bankGroups.has(group) ? `Excluded from the ${group === "checking" ? "checking/cash" : "savings"} planning balance because connected accounts take precedence` : `Used as a ${group === "checking" ? "checking/cash" : "savings"} planning balance source`;
    const prefix = `account${index + 1}`;
    facts[`${prefix}Id`] = row.id; facts[`${prefix}Name`] = row.name; facts[`${prefix}Type`] = row.kind; facts[`${prefix}Source`] = row.connected ? "connected" : "manual";
    facts[`${prefix}RecordedBalance`] = row.balance; facts[`${prefix}BalanceAsOf`] = row.date; facts[`${prefix}Planning`] = planning;
    if (row.identityKnown === false) missing.push(`${row.name}: account identity is incomplete`);
    if (credit && row.balance !== null) {
      const sign = liabilitySign(row.balance);
      facts[`${prefix}LiabilityStatus`] = sign.status; facts[`${prefix}AmountOwed`] = sign.owed; facts[`${prefix}AccountCredit`] = sign.credit;
    }
    if (row.balance === null) missing.push(`${row.name}: recorded balance unavailable`);
    if (!row.date || row.date > snapshot.today) missing.push(`${row.name}: balance observation date ${row.date ? "is in the future" : "unavailable"}`);
    const observed = row.date && row.date <= snapshot.today ? `as of ${row.date}` : row.date ? `dated ${row.date} (future date; unverified)` : "with observation date unavailable (unverified)";
    return `${row.name} — ${row.connected ? "connected" : "manual"} ${row.kind}: ${row.balance === null ? "balance unavailable" : `${dollars(row.balance)} recorded ${credit ? "liability balance" : "balance"}`} ${observed}. ${credit && row.balance !== null ? `${liabilitySign(row.balance).text} ` : ""}${planning}.`;
  });
  if (rows.some(row => row.kind === "unknown")) missing.push("Some recorded account types are unknown; no planning classification is assumed");
  const dates = [...new Set(rows.map(row => row.date).filter(Boolean))];
  facts.inventoryComplete = missing.length === 0;
  const intro = missing.length ? "Recorded accounts I could verify (coverage or observations are incomplete):" : rows.length ? "Your active recorded accounts:" : "No active accounts are recorded in the checked account sources. This does not establish a zero cash balance.";
  return { text: `${intro}${lines.length ? `\n\n${lines.join("\n\n")}` : ""}${dates.length > 1 ? "\n\nThe observation dates differ; these are not simultaneous balances." : ""}\n\nNo combined cash-and-debt total is calculated.`, facts, sources, assumptions, missing: [...new Set(missing)], scenario: false };
}

/** Observations only: no forecast, available-funds or affordability inference. */
export function currentBalanceAnalysis(snapshot: AnalysisSnapshot, request: AnalysisRequest, question?: string, reference?: AccountReferenceProvenance): AnalysisResult {
  const sources = ["accounts", "plaid_accounts", ...(request.entity ? ["bills"] : [])];
  const missing = requireSources(snapshot, sources);
  const assumptions = ["These are recorded balance observations, not live bank funds or safe-to-spend amounts. Pending transactions and future obligations are not deducted here."];
  const unavailable = (reason: string): AnalysisResult => ({text: reason, facts: {}, sources, assumptions, missing: [...new Set([...missing, reason])], scenario: false});
  if (request.scenario || request.dateEvent !== "none" || [request.startDate, request.endDate].some(date => date !== null && date !== snapshot.today) || !["summary", "detail", "search"].includes(request.operation)) {
    return unavailable("This account tool can report the latest recorded balance only. Account-specific historical or future balances are unavailable; the household forecast must not be substituted for a named account.");
  }
  if (missing.length) return unavailable("I could not fully check the recorded accounts, so I cannot confirm this balance.");
  const rows = (name: string) => snapshot.sources[name]?.rows ?? [];
  const all = recordedAccountRows(snapshot);
  const cash = all.filter(row => ["checking", "savings", ...(!row.connected ? ["cash"] : [])].includes(row.kind));
  const manual = cash.filter(row => !row.connected), connected = cash.filter(row => row.connected);
  const entity = normalizeAccountName(request.entity);
  const referenceTarget = reference ? resolveAccountName(recordedBalanceTargets(snapshot), reference.userPhrase).selected : null;
  const verifiedReference = Boolean(reference && question && isCurrentAccountReferenceQuestion(question) && reference.householdId === snapshot.householdId && referenceTarget && referenceTarget.id === reference.accountId && referenceSource(referenceTarget) === reference.source && normalizeAccountName(referenceTarget.name) === entity);
  if (entity && question && !verifiedReference) {
    const words = normalizeAccountName(question).split(" ");
    if (omittedAccountNumber(question, request.entity!)) return unavailable(`Your account reference includes a number that was not preserved. Please confirm the full saved account name; I cannot select a differently numbered account.${all.length ? ` Available accounts: ${accountChoices(all)}.` : ""}`);
    if (!entity.split(" ").every(token => words.includes(token))) return unavailable(`Please confirm the saved account name. I cannot choose an expanded name that introduces words or digits you did not specify.${all.length ? ` Available accounts: ${accountChoices(all)}.` : ""}`);
  }
  const accountGroup = request.accountGroup ?? (request.domain === "savings" ? "savings" : "checking");
  let selected: BalanceRow[];
  if (entity) {
    const resolved = resolveAccountName(recordedBalanceTargets(snapshot), request.entity!);
    if (!resolved.selected) return unavailable(resolved.candidates.length ? `That name matches more than one active account. Which do you mean: ${accountChoices(resolved.candidates)}?` : `No active recorded account or configured debt matches that name.${all.length ? ` Available accounts: ${accountChoices(all)}.` : ""} Please use a saved account name; I cannot substitute the household balance.`);
    selected = [resolved.selected];
    if (selected[0].identityKnown === false) return unavailable("The matching account has an incomplete recorded identity. I cannot confirm its balance.");
    const liability = ["credit", "credit_card", "configured debt"].includes(selected[0].kind);
    if (!liability && !["checking", "cash", "savings"].includes(selected[0].kind)) return unavailable("That account type is visible in the inventory, but its balance semantics are not supported here. I cannot treat it as checking cash.");
    if (liability && request.accountGroup) return unavailable("The named record is a credit liability, not a checking/cash or savings group balance.");
    if (liability) {
      const account = selected[0];
      if (account.balance === null) return unavailable("The named liability has a missing or invalid recorded balance; it is not zero.");
      if (!account.date || account.date > snapshot.today) return unavailable("The named liability has a missing, invalid or future balance review/observation date. Refresh or review it before relying on the balance.");
      const sign = liabilitySign(account.balance, account.configuredDebt);
      if (sign.status === "negative_configured_balance_unverified") missing.push("The meaning of the negative configured debt-plan balance needs review");
      return { text: `${account.name}: ${dollars(account.balance)} recorded ${account.configuredDebt ? "configured debt-plan balance, last reviewed" : "credit liability balance, observed"} as of ${account.date}. ${sign.text} No other debt, account balance or duplicate source is added.`, facts: { ...(account.configuredDebt ? { namedDebtBalance: account.balance, debtReviewedAsOf: account.date, balanceAsOf: null } : { recordedLiabilityBalance: account.balance, balanceAsOf: account.date }), accountName: account.name, accountType: account.kind, accountCount: 1, liabilityStatus: sign.status, recordedAmountOwed: sign.owed, recordedAccountCredit: sign.credit, safeToSpend: null }, sources, assumptions: [...assumptions, account.configuredDebt ? "This is the named configured debt-plan record; connected credit may represent the same obligation and is not added." : "This is the named account's recorded credit liability; configured debt-plan records are not added."], missing, scenario: false };
    }
    if (request.accountGroup && request.accountGroup !== "all" && (request.accountGroup === "savings" ? selected[0].kind !== "savings" : !["checking", "cash"].includes(selected[0].kind))) return unavailable("The named account does not belong to the requested account group. Confirm whether you mean that account or the group total.");
  } else {
    const selectGroup = (group: "checking" | "savings") => {
      const bank = connected.filter(row => row.kind === group);
      return bank.length ? bank : manual.filter(row => group === "savings" ? row.kind === "savings" : ["checking", "cash"].includes(row.kind));
    };
    selected = accountGroup === "all" ? [...selectGroup("checking"), ...selectGroup("savings")] : selectGroup(accountGroup);
    assumptions.push("For household totals, connected balances take precedence over manual balances of the same planning group, matching the app; savings are kept separate from checking/cash.");
    if (accountGroup !== "savings" && !selected.some(row => ["checking", "cash"].includes(row.kind))) {
      sources.push("household_settings");
      missing.push(...requireSources(snapshot, ["household_settings"]));
      const settings = rows("household_settings")[0];
      if (settings && !missing.length) selected = [...selected, {id:"starting-balance",name:"Configured checking/cash starting balance",aliases:[],kind:"checking",balance:numeric(settings.starting_balance),date:validDate(settings.starting_balance_date) ? settings.starting_balance_date : null,connected:false}];
      if (!settings && accountGroup === "all") missing.push("No checking/cash balance observation is available for the combined total");
    }
    if (missing.length) return unavailable("I could not fully check the recorded account groups, so I cannot confirm the total.");
    if (!selected.length) return unavailable("No recorded active balance is available for this account group; an absent balance is not zero.");
  }
  if (selected.some(row => row.balance === null)) return unavailable("A selected account has a missing or invalid balance. I cannot treat it as zero or return a partial total.");
  if (selected.some(row => !row.date || row.date > snapshot.today)) return unavailable("A selected account has a missing, invalid or future balance observation date. Reconcile or refresh it before using the balance.");
  const dates = [...new Set(selected.map(row => row.date!))].sort();
  const total = sum(selected.map(row => row.balance!));
  const scope = entity ? selected[0].name : accountGroup === "all" ? "Checking/cash and savings" : accountGroup === "savings" ? "Savings" : "Checking/cash";
  const dated = dates.length === 1 ? `as of ${dates[0]}` : `from observations dated ${dates[0]} through ${dates[dates.length-1]} (not one simultaneous balance)`;
  const detail = selected.length > 1 ? `\n\n${selected.map(row => `${row.name}: ${dollars(row.balance!)} as of ${row.date}.`).join("\n")}` : "";
  return {text:`${scope}: ${dollars(total)} recorded ${dated}.${detail}\n\nThis is not a live available-funds or safe-to-spend amount.`, facts:{recordedBalance:total,accountCount:selected.length,accountName:entity?selected[0].name:null,accountType:entity?selected[0].kind:accountGroup === "all"?"checking/cash and savings":accountGroup === "savings"?"savings":"checking/cash",balanceAsOf:dates.length===1?dates[0]:null,oldestObservationDate:dates[0],newestObservationDate:dates[dates.length-1],safeToSpend:null},sources,assumptions,missing,scenario:false};
}

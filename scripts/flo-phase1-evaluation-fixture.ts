/** Fixed fictional Phase 1 corpus. No credentials, database or arbitrary inputs. */
import { createFloEvaluationClient, evaluationNow, evaluationHousehold } from "./flo-evaluation-fixture.ts";
export { evaluationNow, evaluationHousehold };

export const phaseOneCases = [
  { id: "inventory", question: "What accounts can you see?", expected: { accountCount: 7, noCashDebtTotal: true } },
  { id: "saved-name", question: "What is my Cedar Daily Checking balance?", expected: { recordedBalance: 700 } },
  { id: "provider-alias", question: "What is my Cedar Bank Everyday balance?", expected: { recordedBalance: 700 } },
  { id: "punctuation", question: "What is my CEDAR-Daily Checking balance?", expected: { recordedBalance: 700 } },
  { id: "abbreviation", question: "What is my Cedar Daily balance?", expected: { recordedBalance: 700 } },
  { id: "natural-name", question: "Could you check how much is sitting in Cedar Daily?", expected: { recordedBalance: 700 } },
  { id: "natural-ambiguous", question: "How much is sitting in Reserve?", expected: { clarification: true, noPickedBalance: true } },
  { id: "ambiguous", question: "What is my Reserve balance?", expected: { clarification: true, noPickedBalance: true } },
  { id: "numeric-name", question: "What is my Reserve 2 balance?", expected: { recordedBalance: 220 } },
  { id: "inactive", question: "What is my Retired checking balance?", expected: { noPickedBalance: true } },
  { id: "manual-name", question: "What is my Travel Wallet balance?", expected: { recordedBalance: 40 } },
  { id: "checking-precedence", question: "What is my checking balance?", expected: { recordedBalance: 700 } },
  { id: "savings-separate", question: "What is my savings balance?", expected: { recordedBalance: 330 } },
  { id: "reconnect", question: "What is my Cedar Daily Checking balance?", expected: { recordedBalance: 700, accountCount: 1 } },
  { id: "missing-balance", question: "What is my Cedar Daily Checking balance?", expected: { noPickedBalance: true } },
  { id: "zero-balance", question: "What is my Cedar Daily Checking balance?", expected: { recordedBalance: 0 } },
  { id: "missing-date", question: "What is my Cedar Daily Checking balance?", expected: { noPickedBalance: true } },
  { id: "future-date", question: "What is my Cedar Daily Checking balance?", expected: { noPickedBalance: true } },
  { id: "mixed-dates", question: "What is my savings balance?", expected: { recordedBalance: 330, balanceAsOf: null } },
  { id: "manual-card", question: "What is the balance on my Test Card debt?", expected: { configuredDebt: 1000, noCheckingSubstitution: true } },
  { id: "numbered-paraphrase", question: "Please tell me the balance for Reserve 2", expected: { recordedBalance: 220 } },
  { id: "missing-numbered-paraphrase", question: "Please tell me the balance for Reserve 2", expected: { noPickedBalance: true } },
  { id: "missing-marker-chain", question: "Please inspect Reserve account number 2 balance", expected: { noPickedBalance: true } },
  { id: "missing-no-dot", question: "Please inspect Reserve No.2 balance", expected: { noPickedBalance: true } },
  { id: "negative-card-balance", question: "What is my Main Card balance?", expected: { recordedLiabilityBalance: -50, liabilityStatus: "account_credit", recordedAmountOwed: 0, recordedAccountCredit: 50 } },
  { id: "zero-card-balance", question: "What is my Main Card balance?", expected: { recordedLiabilityBalance: 0, liabilityStatus: "no_amount_owed", recordedAmountOwed: 0 } },
  { id: "connected-card-balance", question: "What is my Main Card balance?", expected: { recordedLiabilityBalance: 400, noCheckingSubstitution: true } },
  { id: "manual-card-short", question: "What is my Test Card balance?", expected: { namedDebtBalance: 1000, noCheckingSubstitution: true } },
  { id: "connected-card", question: "What is my Main Card credit utilization?", expected: { cardBalance: 400, utilizationPercent: 20 } },
  { id: "missing-name", question: "What is my Imaginary Bank balance?", expected: { noPickedBalance: true } },
  { id: "future-named", question: "What will my Cedar Daily Checking balance be next Friday?", expected: { noCheckingSubstitution: true } },
  { id: "source-gap", question: "What accounts can you see?", expected: { partial: true } },
] as const;

export function createPhaseOneEvaluationClient(caseId = "inventory") {
  if (!phaseOneCases.some(item => item.id === caseId)) throw new Error("Unknown fixed evaluation case");
  const base = createFloEvaluationClient(), h = evaluationHousehold;
  const manual = (id: string, name: string, kind: string, balance: number) => ({ id, household_id: h, name, account_type: kind, current_balance: balance, balance_as_of: "2026-09-10", is_active: true });
  const checking = { id: "bank-checking", household_id: h, name: "Cedar Bank Everyday", official_name: "Cedar Everyday Account", display_name: "Cedar Daily Checking", account_type: "depository", account_subtype: "checking", current_balance: 700 as number | null, persistent_account_id: "cedar-canonical", is_active: true, updated_at: evaluationNow as string | null };
  const tables: Record<string, Record<string, any>[]> = {
    accounts: [manual("wallet", "Travel Wallet", "cash", 40), manual("manual-checking", "Manual Checking", "checking", 500), manual("reserve-1", "Reserve 1", "savings", 110), manual("reserve-2", "Reserve 2", "savings", 220), manual("manual-card", "Manual Card Account", "credit_card", 75), { ...manual("retired", "Retired checking", "checking", 999), is_active: false }],
    plaid_accounts: [checking, { ...checking, id: "bank-checking-old", display_name: "Old Cedar Checking", current_balance: 600, updated_at: "2026-09-09T15:00:00Z" }, { id: "main-card", household_id: h, name: "Main Card", display_name: "Main Card", account_type: "credit", account_subtype: "credit card", is_active: true, current_balance: 400, credit_limit: 2000, purchase_apr: 22, minimum_payment_amount: 25, updated_at: evaluationNow, liability_last_synced_at: evaluationNow }],
  };
  if (["missing-numbered-paraphrase", "missing-marker-chain", "missing-no-dot"].includes(caseId)) tables.accounts = tables.accounts.filter(row => row.id !== "reserve-2");
  if (caseId === "negative-card-balance") tables.plaid_accounts.find(row => row.id === "main-card")!.current_balance = -50;
  if (caseId === "zero-card-balance") tables.plaid_accounts.find(row => row.id === "main-card")!.current_balance = 0;
  if (caseId === "missing-balance") checking.current_balance = null;
  if (caseId === "zero-balance") checking.current_balance = 0;
  if (caseId === "missing-date") { checking.updated_at = null; tables.plaid_accounts = tables.plaid_accounts.filter(row => row.id !== "bank-checking-old"); }
  if (caseId === "future-date") checking.updated_at = "2026-09-11T15:00:00Z";
  if (caseId === "mixed-dates") tables.accounts.find(row => row.id === "reserve-1")!.balance_as_of = "2026-09-08";
  return { from(table: string) {
    if (!Object.hasOwn(tables, table)) return base.from(table);
    let selected = [...tables[table]], take = Infinity;
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { selected = selected.filter(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { selected = selected.filter(row => row[key] !== value); return query; },
      gt(key: string, value: string) { selected = selected.filter(row => String(row[key]) > value); return query; },
      order(key: string, options?: { ascending?: boolean }) { selected.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (options?.ascending === false ? -1 : 1)); return query; },
      limit(value: number) { take = value; return query; },
      maybeSingle: async () => ({ data: selected[0] ?? null, error: null }),
      then(resolve: any) { return Promise.resolve(caseId === "source-gap" && table === "accounts" ? { data: null, error: { message: "Fictional source unavailable" } } : { data: selected.slice(0, take), error: null }).then(resolve); },
    };
    return query;
  } };
}

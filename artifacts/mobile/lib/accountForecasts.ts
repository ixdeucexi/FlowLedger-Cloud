import type {
  Account,
  ConnectedBankAccount,
  DailyBalance,
  FinancialProjectionSnapshot,
} from "./financialProjectionTypes";
import { anchorForecastToBankBalance, type FinancialEvent } from "./forecast";
import { localDateInTimeZone } from "./dailyCheckingClose";
import { savingsInterestCredits } from "./savingsInterest";
import { createDepositoryTransactionAccountKindClassifier } from "./ledgerEngine";
import { createTransactionNameResolver } from "./transactionNames";
import { scenarioDates } from "./decisions";

export type ForecastAccountRef = `manual:${string}` | `bank:${string}`;
export type ForecastRoutingEntity =
  | "bill"
  | "income"
  | "goal"
  | "decision"
  | "extra_payment"
  | "transaction";
export interface ForecastRoutingPatch {
  funding_account_ref?: ForecastAccountRef | null;
  deposit_account_ref?: ForecastAccountRef | null;
  forecast_account_ref?: ForecastAccountRef | null;
  /** Expected local identity when changing a manual transaction's account. */
  account_id?: string | null;
}
export type ForecastPlanAccountField =
  | "funding_account_ref"
  | "deposit_account_ref"
  | "forecast_account_ref";
export interface ForecastPlanItem extends UnassignedAccountPlan {
  detail: string;
  fields: ForecastPlanAccountField[];
  funding?: string | null;
  deposit?: string | null;
  /** Stored editable reference, not a derived alias: CAS compares this exact value. */
  forecast?: ForecastAccountRef | null;
  accountId?: string | null;
  readOnlyReason?: string;
}
export interface ForecastPlanCoverage {
  startDate: string;
  endDate: string;
  plans: ForecastPlanItem[];
  unassigned: UnassignedAccountPlan[];
}
export interface ForecastRoutingChange {
  entityType: Exclude<ForecastRoutingEntity, "transaction">;
  entityId: string;
  patch: ForecastRoutingPatch;
  expected: ForecastRoutingPatch;
}
export interface AccountForecastPreference {
  household_id: string;
  account_ref: ForecastAccountRef;
  savings_apy: number | null;
  safety_floor: number | null;
  updated_at: string;
}
export interface ForecastAccountDescriptor {
  ref: ForecastAccountRef;
  name: string;
  type: "checking" | "savings" | "cash";
  source: "manual" | "bank";
  mask?: string;
  currentBalance: number | null;
  availableBalance: number | null;
  asOfDate: string | null;
  observedAt?: string;
  active: boolean;
  aliases: string[];
  savingsApy: number | null;
  safetyFloor: number | null;
  manualAccountId?: string;
  bankAccountId?: string;
  unavailableReason?: string;
}
export interface UnassignedAccountPlan {
  type: ForecastRoutingEntity;
  id: string;
  name: string;
  date?: string;
  amount?: number;
}
export interface AccountForecastResult {
  account: ForecastAccountDescriptor | null;
  days: DailyBalance[];
  unassigned: UnassignedAccountPlan[];
  complete: boolean;
  unavailableReason: string | null;
  estimatedInterest: number;
  lowestBalance: number | null;
  endingBalance: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const nullableNumber = (value: unknown): number | null =>
  value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value)
    : null;

export function parseForecastAccountRef(
  value: unknown,
): ForecastAccountRef | null {
  if (typeof value !== "string" || value.length > 256 || value !== value.trim())
    return null;
  if (value.startsWith("bank:") && UUID.test(value.slice(5)))
    return `bank:${value.slice(5).toLowerCase()}`;
  if (
    value.startsWith("manual:") &&
    value.length > 7 &&
    !/[\s\u0000-\u001f/\\]/.test(value.slice(7))
  )
    return value as ForecastAccountRef;
  return null;
}

export function normalizeAccountForecastPreference(
  row: any,
): AccountForecastPreference | null {
  const ref = parseForecastAccountRef(row?.account_ref);
  const apy = nullableNumber(row?.savings_apy);
  const floor = nullableNumber(row?.safety_floor);
  if (
    !ref ||
    !row?.household_id ||
    (row?.savings_apy != null && (apy === null || apy < 0 || apy > 100)) ||
    (row?.safety_floor != null && (floor === null || floor < 0))
  )
    return null;
  return {
    household_id: String(row.household_id),
    account_ref: ref,
    savings_apy: apy,
    safety_floor: floor,
    updated_at: String(row.updated_at ?? ""),
  };
}

function bankCashType(
  row: ConnectedBankAccount,
): "checking" | "savings" | null {
  const type = String(row.account_type ?? "").toLowerCase();
  const subtype = String(row.account_subtype ?? "").toLowerCase();
  if (type !== "depository") return null;
  return subtype === "checking" || subtype === "savings" ? subtype : null;
}

/** No names or masks are used as identity. Only stored bank identities and explicit links count. */
export function buildForecastAccountCatalog(input: {
  accounts: readonly Account[];
  bankAccounts: readonly ConnectedBankAccount[];
  preferences?: readonly AccountForecastPreference[];
  householdId?: string | null;
  budgetId?: string | null;
  timeZone?: string;
}): ForecastAccountDescriptor[] {
  const local = input.accounts.filter(
    (row) =>
      (!input.householdId ||
        !row.household_id ||
        row.household_id === input.householdId) &&
      (!input.budgetId || !row.budget_id || row.budget_id === input.budgetId),
  );
  const localById = new Map(local.map((row) => [row.id, row]));
  const preferences = new Map(
    (input.preferences ?? [])
      .filter(
        (row) => !input.householdId || row.household_id === input.householdId,
      )
      .map((row) => [row.account_ref, row]),
  );
  const groups = new Map<string, ConnectedBankAccount[]>();
  for (const row of input.bankAccounts) {
    if (
      !UUID.test(row.id) ||
      !bankCashType(row) ||
      (input.householdId && row.household_id !== input.householdId)
    )
      continue;
    const persistent = String(row.persistent_account_id ?? "").trim();
    const key = persistent ? `persistent:${persistent}` : `row:${row.id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const descriptors: ForecastAccountDescriptor[] = [];
  const hiddenLocalIds = new Set<string>();
  const claimedLocal = new Map<string, ForecastAccountDescriptor[]>();
  for (const rows of groups.values()) {
    const sorted = [...rows].sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) ||
        a.id.localeCompare(b.id),
    );
    const row = sorted[0];
    const ref = `bank:${row.id.toLowerCase()}` as ForecastAccountRef;
    const links = new Set(
      rows
        .flatMap((item) => [item.flowledger_account_id, item.account_id])
        .filter((id): id is string => Boolean(id)),
    );
    const validLinks = [...links].filter((id) => localById.has(id));
    const unsupportedCurrency = rows.some(
      (item) =>
        item.currency_code != null &&
        item.currency_code.trim().toUpperCase() !== "USD",
    );
    const conflict =
      links.size > 1 ||
      links.size !== validLinks.length ||
      rows.some((item) => bankCashType(item) !== bankCashType(row)) ||
      validLinks.some(
        (id) => localById.get(id)?.account_type !== bankCashType(row),
      );
    const current =
      row.current_balance_available === false
        ? null
        : nullableNumber(row.current_balance);
    let asOf: string | null = null;
    if (row.updated_at) {
      try {
        asOf = localDateInTimeZone(
          new Date(row.updated_at),
          input.timeZone ?? "UTC",
        );
      } catch {
        asOf = null;
      }
    }
    const preference =
      preferences.get(ref) ??
      rows
        .map((item) => preferences.get(`bank:${item.id.toLowerCase()}`))
        .find(Boolean) ??
      validLinks.map((id) => preferences.get(`manual:${id}`)).find(Boolean);
    const descriptor: ForecastAccountDescriptor = {
      ref,
      name:
        row.display_name?.trim() ||
        row.name ||
        row.official_name ||
        "Bank account",
      type: bankCashType(row)!,
      source: "bank",
      mask: row.mask,
      currentBalance: conflict || unsupportedCurrency ? null : current,
      availableBalance:
        conflict || unsupportedCurrency
          ? null
          : nullableNumber(row.available_balance),
      asOfDate: asOf,
      observedAt: row.updated_at,
      active: row.is_active,
      aliases: [
        ...new Set(
          rows.flatMap((item) => [
            `bank:${item.id.toLowerCase()}`,
            `row:${item.id.toLowerCase()}`,
            ...(item.plaid_account_id
              ? [`provider:${item.plaid_account_id}`]
              : []),
            ...validLinks.map((id) => `manual:${id}`),
          ]),
        ),
      ],
      savingsApy: preference?.savings_apy ?? null,
      safetyFloor: preference?.safety_floor ?? null,
      bankAccountId: row.id,
      manualAccountId: validLinks.length === 1 ? validLinks[0] : undefined,
      ...(unsupportedCurrency
        ? {
            unavailableReason:
              "This account uses a different currency. USD forecasts are unavailable.",
          }
        : {}),
      ...(conflict
        ? {
            unavailableReason:
              "This account's link needs review before it can be forecast.",
          }
        : {}),
    };
    descriptors.push(descriptor);
    validLinks.forEach((id) => {
      const claims = claimedLocal.get(id) ?? [];
      claims.push(descriptor);
      claimedLocal.set(id, claims);
    });
    if (!conflict && row.is_active)
      validLinks.forEach((id) => hiddenLocalIds.add(id));
  }
  for (const [id, claims] of claimedLocal) {
    const active = claims.filter((row) => row.active);
    if (active.length <= 1) continue;
    hiddenLocalIds.delete(id);
    active.forEach((row) => {
      row.currentBalance = null;
      row.availableBalance = null;
      row.unavailableReason =
        "More than one bank account is linked to this account. Review the link first.";
    });
  }
  for (const row of local) {
    if (hiddenLocalIds.has(row.id)) continue;
    const ref = `manual:${row.id}` as ForecastAccountRef;
    const preference = preferences.get(ref);
    const ambiguous =
      (claimedLocal.get(row.id)?.filter((item) => item.active).length ?? 0) > 1;
    descriptors.push({
      ref,
      name: row.name,
      type: row.account_type,
      source: "manual",
      active: row.is_active,
      currentBalance: ambiguous ? null : nullableNumber(row.current_balance),
      availableBalance: ambiguous ? null : nullableNumber(row.current_balance),
      asOfDate: DATE.test(row.balance_as_of) ? row.balance_as_of : null,
      aliases: [ref],
      manualAccountId: row.id,
      savingsApy: preference?.savings_apy ?? null,
      safetyFloor: preference?.safety_floor ?? null,
      ...(ambiguous
        ? {
            unavailableReason:
              "Review the bank links before forecasting this account.",
          }
        : {}),
    });
  }
  const aliases = new Map<string, Set<ForecastAccountDescriptor>>();
  descriptors
    .filter((row) => row.active)
    .forEach((row) =>
      row.aliases.forEach((alias) => {
        const list = aliases.get(alias) ?? new Set();
        list.add(row);
        aliases.set(alias, list);
      }),
    );
  for (const [alias, rows] of aliases) {
    if (rows.size <= 1 || !alias.startsWith("provider:")) continue;
    rows.forEach((row) => {
      row.currentBalance = null;
      row.availableBalance = null;
      row.unavailableReason =
        "The bank account identity is ambiguous. Refresh or review the connection.";
    });
  }
  return descriptors.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name) ||
      a.ref.localeCompare(b.ref),
  );
}

export function resolveForecastAccountReference(
  value: unknown,
  accounts: readonly ForecastAccountDescriptor[],
  includeInactive = false,
): ForecastAccountRef | null {
  const ref = parseForecastAccountRef(value);
  if (!ref) return null;
  const matches = accounts.filter(
    (account) =>
      (includeInactive || account.active) &&
      (account.ref === ref || account.aliases.includes(ref)),
  );
  return matches.length === 1 && !matches[0].unavailableReason
    ? matches[0].ref
    : null;
}

export function transactionForecastAccountRef(
  transaction: {
    source?: string;
    account_id?: string | null;
    plaid_account_id?: string | null;
    forecast_account_ref?: string | null;
  },
  accounts: readonly ForecastAccountDescriptor[],
  includeInactive = false,
): ForecastAccountRef | null {
  if (transaction.source === "plaid" || transaction.plaid_account_id) {
    const id = transaction.plaid_account_id;
    if (!id) return null;
    const matches = accounts.filter(
      (account) =>
        account.source === "bank" &&
        (includeInactive || account.active) &&
        (account.aliases.includes(`provider:${id}`) ||
          account.aliases.includes(`row:${id.toLowerCase()}`)) &&
        !account.unavailableReason,
    );
    if (matches.length !== 1) return null;
    // A saved editable field cannot relocate an imported bank payment.
    if (
      transaction.forecast_account_ref &&
      resolveForecastAccountReference(
        transaction.forecast_account_ref,
        accounts,
        includeInactive,
      ) !== matches[0].ref
    )
      return null;
    return matches[0].ref;
  }
  const explicit = transaction.forecast_account_ref
    ? resolveForecastAccountReference(
        transaction.forecast_account_ref,
        accounts,
        includeInactive,
      )
    : null;
  const local = transaction.account_id
    ? resolveForecastAccountReference(
        `manual:${transaction.account_id}`,
        accounts,
        includeInactive,
      )
    : null;
  if (transaction.forecast_account_ref && !explicit) return null;
  if (explicit && local && explicit !== local) return null;
  return explicit ?? local;
}

export { savingsInterestCredits, validateSavingsApy } from "./savingsInterest";

export function createEventForecastAccountResolver(
  snapshot: FinancialProjectionSnapshot,
  accounts: readonly ForecastAccountDescriptor[],
): (event: FinancialEvent) => ForecastAccountRef | null {
  let transactions:
    | Map<string, (typeof snapshot.transactions)[number]>
    | undefined;
  const getTransaction = (id: string) => {
    transactions ??= new Map(
      [...snapshot.transactions, ...snapshot.deletedTransactions].map((row) => [
        row.id,
        row,
      ]),
    );
    return transactions.get(id);
  };
  const bills = new Map(snapshot.bills.map((row) => [row.id, row]));
  const incomes = new Map(snapshot.incomes.map((row) => [row.id, row]));
  const goals = new Map(snapshot.goals.map((row) => [row.id, row]));
  const extras = new Map(snapshot.extraPayments.map((row) => [row.id, row]));
  const decisions = new Map(snapshot.decisions.map((row) => [row.id, row]));
  const transactionRefs = new Map<string, ForecastAccountRef | null>();
  return (event) => {
    if (event.sourceType === "transaction") {
      if (transactionRefs.has(event.sourceId))
        return transactionRefs.get(event.sourceId)!;
      const row = getTransaction(event.sourceId),
        ref = row ? transactionForecastAccountRef(row, accounts) : null;
      transactionRefs.set(event.sourceId, ref);
      return ref;
    }
    if (event.accountRef)
      return resolveForecastAccountReference(event.accountRef, accounts);
    let ref: unknown;
    if (
      event.debtPlanSource === "saved_extra" ||
      event.debtPlanAllocationKind === "rollover" ||
      event.debtPauseRedirect
    )
      ref = event.fundingAccountRef;
    else if (event.debtTargetBillId)
      ref = bills.get(event.debtTargetBillId)?.funding_account_ref;
    else if (event.sourceType === "bill")
      ref = bills.get(event.sourceId)?.funding_account_ref;
    else if (event.sourceType === "income")
      ref = incomes.get(event.sourceId)?.deposit_account_ref;
    else if (event.sourceType === "goal")
      ref = goals.get(event.sourceId)?.funding_account_ref;
    else if (event.sourceType === "extra_payment")
      ref = extras.get(event.sourceId)?.funding_account_ref;
    else if (event.sourceType === "decision") {
      const decision = decisions.get(event.sourceId);
      ref =
        decision?.scenario.type === "income_change"
          ? decision.deposit_account_ref
          : decision?.scenario.type === "savings_contribution" &&
              event.amount >= 0
            ? decision.deposit_account_ref
            : decision?.funding_account_ref;
    }
    return resolveForecastAccountReference(ref, accounts);
  };
}

export function eventForecastAccountRef(
  event: FinancialEvent,
  snapshot: FinancialProjectionSnapshot,
  accounts: readonly ForecastAccountDescriptor[],
): ForecastAccountRef | null {
  return createEventForecastAccountResolver(snapshot, accounts)(event);
}

export function accountMatchEligibility(
  source: ForecastAccountRef | null,
  target: ForecastAccountRef | null,
  allowCrossAccount = false,
): boolean {
  return Boolean(source) && (!target || source === target || allowCrossAccount);
}

/** A transfer changes cash only when both explicit, opposite legs are present. */
export function pairedTransferEvents(
  snapshot: FinancialProjectionSnapshot,
  accounts: readonly ForecastAccountDescriptor[],
  prefix: string,
): FinancialEvent[] {
  const groups = new Map<string, typeof snapshot.transactions>();
  for (const row of snapshot.transactions) {
    if (
      !row.transfer_group_id ||
      row.deleted_at ||
      row.removed_at ||
      row.pending
    )
      continue;
    const group = groups.get(row.transfer_group_id) ?? [];
    group.push(row);
    groups.set(row.transfer_group_id, group);
  }
  const events: FinancialEvent[] = [];
  for (const rows of groups.values()) {
    if (rows.length !== 2) continue;
    const [a, b] = rows;
    const ar = transactionForecastAccountRef(a, accounts),
      br = transactionForecastAccountRef(b, accounts);
    if (
      !ar ||
      !br ||
      ar === br ||
      a.date !== b.date ||
      !Number.isFinite(a.amount) ||
      !Number.isFinite(b.amount) ||
      Math.abs(a.amount + b.amount) > 0.005 ||
      a.amount * b.amount >= 0
    )
      continue;
    for (const row of rows)
      if (row.date.startsWith(prefix))
        events.push({
          id: `transaction:${row.id}`,
          sourceType: "transaction",
          sourceId: row.id,
          date: row.date,
          kind: row.amount < 0 ? "transaction_expense" : "transaction_income",
          amount: row.amount,
          status: "planned",
          name: row.note || "Transfer",
          accountRef: transactionForecastAccountRef(row, accounts)!,
          transfer: true,
        });
  }
  return events;
}

export function isOperatingCashEvent(
  event: FinancialEvent,
  snapshot: FinancialProjectionSnapshot,
  accounts: readonly ForecastAccountDescriptor[],
): boolean {
  if (event.sourceType === "transaction") {
    const transaction =
      snapshot.transactions.find((row) => row.id === event.sourceId) ??
      snapshot.deletedTransactions.find((row) => row.id === event.sourceId);
    if (transaction?.source === "plaid")
      return (
        createDepositoryTransactionAccountKindClassifier(
          snapshot.transactionAccountIdentities,
        )(transaction) === "checking"
      );
  }
  const ref = eventForecastAccountRef(event, snapshot, accounts);
  return (
    !ref || accounts.find((account) => account.ref === ref)?.type !== "savings"
  );
}

/** Coverage comes from effective canonical cash events, not every saved record. */
export function buildForecastPlanCoverage(input: {
  snapshot: FinancialProjectionSnapshot;
  accounts: readonly ForecastAccountDescriptor[];
  startDate: string;
  endDate: string;
  events: readonly FinancialEvent[];
}): ForecastPlanCoverage {
  const { snapshot, accounts, startDate, endDate } = input;
  const records = {
    bill: new Map(snapshot.bills.map((row) => [row.id, row])),
    income: new Map(snapshot.incomes.map((row) => [row.id, row])),
    goal: new Map(snapshot.goals.map((row) => [row.id, row])),
    decision: new Map(snapshot.decisions.map((row) => [row.id, row])),
    extra_payment: new Map(snapshot.extraPayments.map((row) => [row.id, row])),
    transaction: new Map(snapshot.transactions.map((row) => [row.id, row])),
  };
  const plans = new Map<string, ForecastPlanItem>();
  const add = (
    type: ForecastRoutingEntity,
    id: string,
    date: string,
    amount: number,
  ) => {
    const row: any = records[type].get(id);
    if (
      !row ||
      (type === "decision" &&
        row.scenario.type === "savings_contribution" &&
        amount > 0)
    )
      return;
    if (
      type === "goal" &&
      (row.goal_type !== "planned_expense" || row.closed_at || row.archived_at)
    )
      return;
    if (
      type === "transaction" &&
      (row.source === "plaid" ||
        row.import_hash ||
        row.deleted_at ||
        row.removed_at ||
        row.transfer_group_id)
    )
      return;
    const key = `${type}:${id}`,
      previous = plans.get(key);
    if (previous) {
      previous.amount = money((previous.amount ?? 0) + Math.abs(amount));
      if (date < (previous.date ?? date)) previous.date = date;
      return;
    }
    const fields: ForecastPlanAccountField[] =
      type === "income"
        ? ["deposit_account_ref"]
        : type === "transaction"
          ? ["forecast_account_ref"]
          : type === "decision" && row.scenario.type === "savings_contribution"
            ? ["funding_account_ref", "deposit_account_ref"]
            : type === "decision" && row.scenario.type === "income_change"
              ? ["deposit_account_ref"]
              : ["funding_account_ref"];
    const readonly =
      type === "transaction" &&
      (row.linked_bill_id ||
        row.linked_plan_id ||
        row.linked_income_id ||
        row.debt_applied_bill_id ||
        row.review_allocations?.some(
          (allocation: any) =>
            !["category", "transfer"].includes(allocation.type),
        ));
    plans.set(key, {
      type,
      id,
      name: row.name || row.note || row.category || "Planned activity",
      date,
      amount: Math.abs(amount),
      detail:
        type === "bill"
          ? row.is_debt
            ? "Debt payment"
            : "Bill"
          : type === "income"
            ? "Income"
            : type === "goal"
              ? "Spending bucket"
              : type === "decision"
                ? "Calendar plan"
                : type === "extra_payment"
                  ? "Extra debt payment"
                  : "Planned activity",
      fields,
      funding: row.funding_account_ref ?? null,
      deposit: row.deposit_account_ref ?? null,
      forecast: parseForecastAccountRef(row.forecast_account_ref),
      accountId: row.account_id ?? null,
      ...(readonly
        ? {
            readOnlyReason:
              "Review this matched activity before changing its account.",
          }
        : {}),
    });
  };
  const seenEvents = new Set<string>();
  for (const event of input.events) {
    if (
      seenEvents.has(event.id) ||
      !Number.isFinite(event.amount) ||
      Math.abs(event.amount) <= 0.005 ||
      event.date > endDate
    )
      continue;
    seenEvents.add(event.id);
    const reserve =
      event.amount < 0 &&
      ["planned", "scheduled", "pending"].includes(event.status) &&
      (event.kind === "bill" ||
        event.kind === "goal" ||
        (event.kind === "debt_payment" &&
          event.debtPlanAllocationKind === "required"));
    if (event.date < startDate && !reserve) continue;
    if (
      event.sourceType !== "transaction" &&
      !["planned", "scheduled", "pending"].includes(event.status)
    )
      continue;
    if (event.debtPlanSource === "saved_extra")
      add("extra_payment", event.sourceId, event.date, event.amount);
    else if (event.debtTargetBillId)
      add(
        "bill",
        event.debtPlanAllocationKind === "rollover" || event.debtPauseRedirect
          ? (event.debtPauseRedirect?.fromBillId ?? event.sourceId)
          : event.debtTargetBillId,
        event.date,
        event.amount,
      );
    else if (
      [
        "bill",
        "income",
        "goal",
        "decision",
        "extra_payment",
        "transaction",
      ].includes(event.sourceType)
    )
      add(
        event.sourceType as ForecastRoutingEntity,
        event.sourceId,
        event.date,
        event.amount,
      );
  }
  // Invalid explicit self-transfers have no cash event; keep their future correction visible.
  for (const row of snapshot.decisions) {
    if (
      !["planned", "calendar"].includes(row.status) ||
      row.scenario.type !== "savings_contribution" ||
      !Number.isFinite(row.scenario.amount) ||
      Math.abs(row.scenario.amount) <= 0.005
    )
      continue;
    const from = resolveForecastAccountReference(
        row.funding_account_ref,
        accounts,
      ),
      to = resolveForecastAccountReference(row.deposit_account_ref, accounts);
    if (from && from === to) {
      const date = scenarioDates(row.scenario, endDate).find(
        (date) => date >= startDate,
      );
      if (date) add("decision", row.id, date, -Math.abs(row.scenario.amount));
    }
  }
  const result = [...plans.values()].sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.name.localeCompare(b.name),
  );
  const unassigned = result
    .filter(
      (item) =>
        item.fields.some(
          (field) =>
            !resolveForecastAccountReference(
              field === "funding_account_ref"
                ? item.funding
                : field === "deposit_account_ref"
                  ? item.deposit
                  : records.transaction.get(item.id)
                    ? transactionForecastAccountRef(
                        records.transaction.get(item.id)!,
                        accounts,
                      )
                    : item.forecast,
              accounts,
            ),
        ) ||
        (item.fields.length === 2 &&
          resolveForecastAccountReference(item.funding, accounts) ===
            resolveForecastAccountReference(item.deposit, accounts)),
    )
    .map(({ type, id, name, date, amount, fields, funding, deposit }) => ({
      type,
      id,
      name:
        fields.length === 2 &&
        resolveForecastAccountReference(funding, accounts) &&
        resolveForecastAccountReference(funding, accounts) ===
          resolveForecastAccountReference(deposit, accounts)
          ? `${name}: choose different source and destination accounts`
          : name,
      date,
      amount,
    }));
  return { startDate, endDate, plans: result, unassigned };
}

export function unassignedAccountPlans(
  snapshot: FinancialProjectionSnapshot,
  accounts: readonly ForecastAccountDescriptor[],
  range: {
    startDate: string;
    endDate: string;
    events: readonly FinancialEvent[];
  },
): UnassignedAccountPlan[] {
  return buildForecastPlanCoverage({ snapshot, accounts, ...range }).unassigned;
}

export function adjustPendingForecastEvents(
  snapshot: FinancialProjectionSnapshot,
  events: readonly FinancialEvent[],
): FinancialEvent[] {
  const adjusted = events.map((event) => ({ ...event }));
  const pending = snapshot.pendingBankTransactions.filter(
    (row) => row.amount < 0 && Number.isFinite(row.amount),
  );
  for (const match of snapshot.pendingPlanMatches.filter(
    (row) => row.status === "active",
  )) {
    const charge = pending.find(
      (row) => row.plaid_transaction_id === match.pending_plaid_transaction_id,
    );
    if (
      !charge ||
      snapshot.pendingPlanMatches.filter(
        (row) =>
          row.status === "active" &&
          row.pending_plaid_transaction_id === charge.plaid_transaction_id,
      ).length !== 1
    )
      continue;
    let covered = Math.min(
      Math.abs(charge.amount),
      Math.max(0, match.planned_amount),
    );
    for (const event of adjusted) {
      if (
        covered <= 0.005 ||
        event.date !== match.occurrence_date ||
        event.amount >= 0
      )
        continue;
      const matches =
        match.target_type === "manual"
          ? event.sourceType === "transaction" &&
            event.sourceId === match.target_id
          : event.debtTargetBillId === match.target_id ||
            (event.sourceType === "bill" && event.sourceId === match.target_id);
      if (!matches) continue;
      const amount = Math.min(covered, -event.amount);
      event.amount += amount;
      covered -= amount;
    }
  }
  return adjusted;
}

export function forecastPlanCoverageForRange(input: {
  snapshot: FinancialProjectionSnapshot;
  accounts: readonly ForecastAccountDescriptor[];
  startDate: string;
  endDate: string;
  getEvents: (
    month: number,
    year: number,
    reservationAsOfDate?: string,
  ) => readonly FinancialEvent[];
}): ForecastPlanCoverage {
  const empty = {
    startDate: input.startDate,
    endDate: input.endDate,
    plans: [],
    unassigned: [],
  };
  if (
    !DATE.test(input.startDate) ||
    !DATE.test(input.endDate) ||
    input.endDate < input.startDate
  )
    return empty;
  const [startYear, startMonth] = input.startDate.split("-").map(Number),
    [endYear, endMonth] = input.endDate.split("-").map(Number);
  if (endYear * 12 + endMonth - (startYear * 12 + startMonth) > 1200)
    return empty;
  const events: FinancialEvent[] = [];
  for (
    let index = startYear * 12 + startMonth - 1;
    index <= endYear * 12 + endMonth - 1;
    index++
  )
    events.push(
      ...input.getEvents(index % 12, Math.floor(index / 12), input.startDate),
    );
  return buildForecastPlanCoverage({
    ...input,
    events: adjustPendingForecastEvents(input.snapshot, events),
  });
}

/** Account forecasts start at that account's verified balance, never a household close. */
export function buildAccountForecast(input: {
  ref: ForecastAccountRef;
  month: number;
  year: number;
  snapshot: FinancialProjectionSnapshot;
  accounts: readonly ForecastAccountDescriptor[];
  getEvents: (
    month: number,
    year: number,
    reservationAsOfDate?: string,
  ) => readonly FinancialEvent[];
}): AccountForecastResult {
  const resolved = resolveForecastAccountReference(input.ref, input.accounts);
  const account = input.accounts.find((row) => row.ref === resolved) ?? null;
  let unassigned: UnassignedAccountPlan[] = [];
  const empty = (reason: string): AccountForecastResult => ({
    account,
    days: [],
    unassigned,
    complete: false,
    unavailableReason: reason,
    estimatedInterest: 0,
    lowestBalance: null,
    endingBalance: null,
  });
  if (!account || !account.active)
    return empty("This account is unavailable. Choose an active account.");
  if (account.currentBalance === null || !account.asOfDate)
    return empty(
      account.unavailableReason ??
        "Refresh or reconcile this account to establish its balance and date.",
    );
  if (
    !Number.isInteger(input.month) ||
    input.month < 0 ||
    input.month > 11 ||
    !Number.isInteger(input.year)
  )
    return empty("Choose a valid forecast month.");
  const prefix = `${input.year}-${String(input.month + 1).padStart(2, "0")}`;
  const end = `${prefix}-${String(new Date(Date.UTC(input.year, input.month + 1, 0)).getUTCDate()).padStart(2, "0")}`;
  if (end < account.asOfDate)
    return empty(
      "Individual account history before its latest balance is unavailable.",
    );
  const [asOfYear, asOfMonth] = account.asOfDate!.split("-").map(Number);
  if (input.year * 12 + input.month - (asOfYear * 12 + asOfMonth - 1) > 1200)
    return empty("Choose a forecast within 100 years.");
  const all: FinancialEvent[] = [];
  for (
    let n = asOfYear * 12 + asOfMonth - 1;
    n <= input.year * 12 + input.month;
    n++
  )
    all.push(...input.getEvents(n % 12, Math.floor(n / 12), account.asOfDate));
  // Explicit provisional matches replace the same planned dollars, before routing.
  // This also handles a deliberate match whose expected payer differs from the bank source.
  const transactionName = createTransactionNameResolver(
    input.snapshot.bills,
    input.snapshot.incomes,
  );
  const namedTransactions = new Map(
    input.snapshot.transactions.map((row) => [row.id, row]),
  );
  const adjusted = adjustPendingForecastEvents(
    input.snapshot,
    all.map((event) => {
      const transaction =
        event.sourceType === "transaction"
          ? namedTransactions.get(event.sourceId)
          : undefined;
      return {
        ...event,
        ...(transaction ? { name: transactionName(transaction) } : {}),
      };
    }),
  );
  const pending = input.snapshot.pendingBankTransactions.filter(
    (row) => row.amount < 0 && Number.isFinite(row.amount),
  );
  unassigned = unassignedAccountPlans(input.snapshot, input.accounts, {
    startDate: account.asOfDate,
    endDate: end,
    events: adjusted,
  });
  const resolveEvent = createEventForecastAccountResolver(
    input.snapshot,
    input.accounts,
  );
  const routed = adjusted.filter(
    (event) =>
      resolveEvent(event) === resolved && Math.abs(event.amount) > 0.005,
  );
  const ownPending = pending.filter(
    (row) =>
      transactionForecastAccountRef(
        { source: "plaid", plaid_account_id: row.plaid_account_id },
        input.accounts,
      ) === resolved,
  );
  const grossPending = ownPending.reduce(
    (sum, row) => sum + Math.abs(row.amount),
    0,
  );
  const availableGap =
    account.availableBalance === null
      ? 0
      : Math.max(0, account.currentBalance - account.availableBalance);
  const pendingEvents: FinancialEvent[] = ownPending.map((row) => ({
    id: `pending:${row.plaid_transaction_id}`,
    sourceType: "account",
    sourceId: row.plaid_transaction_id,
    date: account.asOfDate!,
    kind: "transaction_expense",
    amount: row.amount,
    status: "pending",
    name: row.name,
    accountRef: resolved!,
  }));
  const residual = money(Math.max(0, availableGap - grossPending));
  if (residual > 0.005)
    pendingEvents.push({
      id: `pending-residual:${resolved}`,
      sourceType: "account",
      sourceId: resolved!,
      date: account.asOfDate,
      kind: "transaction_expense",
      amount: -residual,
      status: "pending",
      name: "Other pending bank holds",
      accountRef: resolved!,
    });
  const transactionById = new Map(
    [...input.snapshot.transactions, ...input.snapshot.deletedTransactions].map(
      (row) => [row.id, row],
    ),
  );
  const settled = new Set(
    routed
      .filter((event) => {
        const row =
          event.sourceType === "transaction"
            ? transactionById.get(event.sourceId)
            : undefined;
        return (
          event.date <= account.asOfDate! &&
          (row?.source === "plaid" ||
            row?.source === "statement" ||
            Boolean(row?.import_hash) ||
            event.status === "finalized" ||
            event.status === "applied")
        );
      })
      .map((event) => event.id),
  );
  const future = anchorForecastToBankBalance(
    routed,
    account.currentBalance,
    account.asOfDate,
    settled,
  ).events.filter(
    (event) => event.date >= account.asOfDate! && !settled.has(event.id),
  );
  let interest: FinancialEvent[] = [];
  if (account.type === "savings") {
    try {
      interest = savingsInterestCredits({
        openingPostedBalance: account.currentBalance,
        apy: account.savingsApy,
        asOfDate: account.asOfDate,
        endDate: end,
        events: future,
        accountRef: resolved!,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /^(Choose a valid savings forecast date|The savings|Choose a savings forecast|A verified posted balance|Savings cash events|Enter an APY)/.test(
          error.message,
        )
      )
        return empty(error.message);
      throw error;
    }
  }
  const events = [...future, ...pendingEvents, ...interest];
  const byDate = new Map<string, FinancialEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }
  let running = account.currentBalance;
  const days: DailyBalance[] = [];
  let estimatedInterest = 0;
  const cursor = new Date(`${account.asOfDate}T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const date = cursor.toISOString().slice(0, 10),
      dayEvents = byDate.get(date) ?? [];
    const inflow = dayEvents.reduce(
        (sum, row) => sum + Math.max(0, row.amount),
        0,
      ),
      outflow = dayEvents.reduce(
        (sum, row) => sum + Math.max(0, -row.amount),
        0,
      );
    running = money(running + inflow - outflow);
    if (date.startsWith(prefix)) {
      estimatedInterest += dayEvents
        .filter((row) => row.kind === "estimated_interest")
        .reduce((sum, row) => sum + row.amount, 0);
      days.push({
        day: cursor.getUTCDate(),
        income: inflow,
        scheduledIncome: dayEvents
          .filter((row) => row.kind === "scheduled_income")
          .reduce((sum, row) => sum + row.amount, 0),
        expense: outflow,
        bills: dayEvents
          .filter((row) => row.kind === "bill" || row.kind === "debt_payment")
          .reduce((sum, row) => sum + Math.max(0, -row.amount), 0),
        goalExpenses: [],
        net: money(inflow - outflow),
        balance: running,
        balanceSource: "projected",
        balanceDate: date,
        projectedInflow: inflow,
        projectedOutflow: outflow,
        events: dayEvents,
        projectionEvents: dayEvents,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Preserve calendar geometry, without inventing historical account balances.
  for (let day = (days[0]?.day ?? 1) - 1; day >= 1; day--)
    days.unshift({
      day,
      income: 0,
      scheduledIncome: 0,
      expense: 0,
      bills: 0,
      goalExpenses: [],
      net: 0,
      balance: NaN,
      balanceSource: "unavailable",
      balanceDate: `${prefix}-${String(day).padStart(2, "0")}`,
      events: [],
      projectionEvents: [],
    });
  const balances = days
    .filter((row) => Number.isFinite(row.balance))
    .map((row) => row.balance);
  return {
    account,
    days,
    unassigned,
    complete: unassigned.length === 0,
    unavailableReason: null,
    estimatedInterest: money(estimatedInterest),
    lowestBalance: balances.length ? Math.min(...balances) : null,
    endingBalance: balances.at(-1) ?? null,
  };
}

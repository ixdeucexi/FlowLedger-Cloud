import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountForecast,
  buildForecastAccountCatalog,
  transactionForecastAccountRef,
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "./accountForecasts";
import { createFinancialProjection } from "./financialProjection";
import type {
  FinancialProjectionSnapshot,
  ConnectedBankAccount,
  Bill,
} from "./financialProjectionTypes";
const checking =
  "bank:00000000-0000-4000-8000-000000000001" as ForecastAccountRef;
const billsRef =
  "bank:00000000-0000-4000-8000-000000000002" as ForecastAccountRef;
const savings =
  "bank:00000000-0000-4000-8000-000000000003" as ForecastAccountRef;
function bank(
  ref: ForecastAccountRef,
  subtype: string,
  balance: number,
): ConnectedBankAccount {
  return {
    id: ref.slice(5),
    plaid_account_id: `provider-${ref.slice(-1)}`,
    name: subtype,
    household_id: "household",
    account_type: "depository",
    account_subtype: subtype,
    current_balance: balance,
    available_balance: balance,
    is_active: true,
    updated_at: "2027-01-01T12:00:00Z",
  };
}
function fixture(): FinancialProjectionSnapshot {
  const bankAccounts = [
    bank(checking, "checking", 1000),
    bank(billsRef, "checking", 500),
    bank(savings, "savings", 2000),
  ];
  return {
    settings: {
      zeroBasedBudgetEnabled: false,
      debtPayoffEnabled: true,
      paymentMethod: "snowball",
      starting_balance: 1500,
      starting_balance_date: "2027-01-01",
      safety_floor: 200,
      forecast_horizon_months: 6,
      onboarding_completed: true,
    },
    bills: [],
    overrides: [],
    billDateMoves: [],
    transactions: [],
    deletedTransactions: [],
    incomes: [],
    goals: [],
    extraPayments: [],
    decisions: [],
    accounts: [],
    connectedBankAccounts: bankAccounts,
    transactionAccountIdentities: bankAccounts,
    pendingBankTransactions: [],
    pendingPlanMatches: [],
  };
}
function bill(
  id: string,
  amount: number,
  ref?: ForecastAccountRef,
  debt = false,
): Bill {
  return {
    id,
    name: id,
    amount,
    category: debt ? "Debt" : "Other",
    priority: 1,
    is_debt: debt,
    balance: debt ? 300 : 0,
    interest_rate: 0,
    due_day: 15,
    start_date: "2027-01-01",
    frequency: "monthly",
    is_recurring: true,
    created_at: "2027-01-01",
    funding_account_ref: ref,
  };
}
function projection(snapshot: FinancialProjectionSnapshot) {
  return createFinancialProjection(snapshot, {
    now: new Date("2027-01-01T12:00:00Z"),
    timeZone: "UTC",
  });
}
function own(
  snapshot: FinancialProjectionSnapshot,
  ref: ForecastAccountRef,
  month = 0,
  year = 2027,
) {
  const engine = projection(snapshot);
  return buildAccountForecast({
    ref,
    month,
    year,
    snapshot,
    accounts: buildForecastAccountCatalog({
      accounts: snapshot.accounts,
      bankAccounts: snapshot.transactionAccountIdentities,
    }),
    getEvents: engine.getUnanchoredCashEvents,
  });
}
test("three accounts keep individual openings and Savings outside household operating cash", () => {
  const f = fixture();
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1500);
  assert.equal(own(f, checking).endingBalance, 1000);
  assert.equal(own(f, billsRef).endingBalance, 500);
  assert.equal(own(f, savings).endingBalance, 2000);
});
test("routed bill and income affect only their explicit payer/deposit account", () => {
  const f = fixture();
  f.bills = [bill("Bills payment", 100, billsRef)];
  f.incomes = [
    {
      id: "income",
      name: "Payday",
      amount: 500,
      frequency: "monthly",
      start_date: "2027-01-20",
      deposit_account_ref: checking,
    },
  ];
  assert.equal(own(f, checking).endingBalance, 1500);
  assert.equal(own(f, billsRef).endingBalance, 400);
  assert.equal(own(f, savings).endingBalance, 2000);
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1900);
});
test("Savings-funded expense leaves operating cash and remains in future own carryover", () => {
  const f = fixture();
  f.bills = [bill("Savings bill", 100, savings)];
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1500);
  assert.equal(projection(f).getDailyBalances(1, 2027).at(-1)?.balance, 1500);
  assert.equal(own(f, savings, 1).endingBalance, 1800);
  assert.equal(projection(f).getCashFlow(0, 2027).remaining, 0);
});
test("unassigned legacy bills stay in household and do not borrow an account opening", () => {
  const f = fixture();
  f.bills = [bill("Unassigned bill", 1600)];
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, -100);
  assert.equal(own(f, billsRef).endingBalance, 500);
  assert.equal(own(f, billsRef).complete, false);
  assert.equal(own(f, billsRef).unassigned[0].id, "Unassigned bill");
  f.bills[0].funding_account_ref = billsRef;
  assert.equal(own(f, billsRef).endingBalance, -1100);
  assert.equal(own(f, checking).endingBalance, 1000);
});
test("paired Checking to Savings transfer is zero total, minus operating cash, one impact per account", () => {
  const f = fixture();
  f.transactions = [
    {
      id: "from",
      date: "2027-01-10",
      amount: -200,
      category: "Transfer",
      note: "To Savings",
      transfer_group_id: "pair",
      forecast_account_ref: checking,
      source: "manual",
    },
    {
      id: "to",
      date: "2027-01-10",
      amount: 200,
      category: "Transfer",
      note: "From Checking",
      transfer_group_id: "pair",
      forecast_account_ref: savings,
      source: "manual",
    },
  ];
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1300);
  assert.equal(own(f, checking).endingBalance, 800);
  assert.equal(own(f, savings).endingBalance, 2200);
  assert.equal(own(f, billsRef).endingBalance, 500);
  f.transactions.pop();
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1500);
  assert.equal(own(f, checking).endingBalance, 1000);
});
test("canonical debt plan is generated before account routing with required targets explicit", () => {
  const f = fixture();
  f.bills = [
    bill("debt-one", 100, billsRef, true),
    { ...bill("debt-two", 50, checking, true), priority: 2, balance: 1000 },
  ];
  const raw = projection(f).getUnanchoredCashEvents(0, 2027);
  assert.equal(
    raw
      .filter((row) => row.debtTargetBillId === "debt-one")
      .reduce((sum, row) => sum - row.amount, 0),
    100,
  );
  assert.equal(own(f, billsRef).endingBalance, 400);
  assert.equal(own(f, checking).endingBalance, 950);
});
test("actual bank source accepts provider and row IDs but cannot be reassigned with forecast ref", () => {
  const f = fixture(),
    catalog = buildForecastAccountCatalog({
      accounts: [],
      bankAccounts: f.transactionAccountIdentities,
    });
  assert.equal(
    transactionForecastAccountRef(
      { source: "plaid", plaid_account_id: "provider-3" },
      catalog,
    ),
    savings,
  );
  assert.equal(
    transactionForecastAccountRef(
      { source: "plaid", plaid_account_id: savings.slice(5) },
      catalog,
    ),
    savings,
  );
  assert.equal(
    transactionForecastAccountRef(
      {
        source: "plaid",
        plaid_account_id: "provider-3",
        forecast_account_ref: checking,
      },
      catalog,
    ),
    null,
  );
  assert.equal(
    transactionForecastAccountRef(
      { source: "plaid", plaid_account_id: "missing" },
      catalog,
    ),
    null,
  );
});
test("identity uses explicit bridge only and fails conflicting links rather than name/mask guesses", () => {
  const f = fixture();
  f.accounts = [
    {
      id: "local",
      name: "Savings",
      account_type: "savings",
      current_balance: 2000,
      balance_as_of: "2027-01-01",
      is_active: true,
      created_at: "2027-01-01",
      household_id: "household",
    },
  ];
  let catalog = buildForecastAccountCatalog({
    accounts: f.accounts,
    bankAccounts: f.transactionAccountIdentities,
    householdId: "household",
  });
  assert.equal(catalog.length, 4);
  f.transactionAccountIdentities[2].flowledger_account_id = "local";
  catalog = buildForecastAccountCatalog({
    accounts: f.accounts,
    bankAccounts: f.transactionAccountIdentities,
    householdId: "household",
  });
  assert.equal(catalog.length, 3);
  assert.equal(
    resolveForecastAccountReference("manual:local", catalog),
    savings,
  );
  f.transactionAccountIdentities[0].flowledger_account_id = "local";
  catalog = buildForecastAccountCatalog({
    accounts: f.accounts,
    bankAccounts: f.transactionAccountIdentities,
    householdId: "household",
  });
  assert.equal(resolveForecastAccountReference(savings, catalog), null);
});
test("per-account pending reserves reconcile gross debits and residuals without borrowing another gap", () => {
  const f = fixture();
  f.transactionAccountIdentities[0].available_balance = 850;
  f.transactionAccountIdentities[1].available_balance = 475;
  f.pendingBankTransactions = [
    {
      plaid_transaction_id: "charge",
      plaid_account_id: checking.slice(5),
      transaction_date: "2027-01-01",
      amount: -100,
      name: "Charge",
      category: "Other",
    },
  ];
  assert.equal(own(f, checking).endingBalance, 850);
  assert.equal(own(f, billsRef).endingBalance, 475);
  assert.equal(own(f, savings).endingBalance, 2000);
});
test("pending matched plan counts once including deliberate different-account payer", () => {
  const f = fixture();
  f.bills = [bill("bill", 100, billsRef)];
  f.pendingBankTransactions = [
    {
      plaid_transaction_id: "charge",
      plaid_account_id: checking.slice(5),
      transaction_date: "2027-01-01",
      amount: -100,
      name: "Charge",
      category: "Other",
    },
  ];
  f.pendingPlanMatches = [
    {
      id: "match",
      pending_plaid_transaction_id: "charge",
      pending_account_id: checking.slice(5),
      target_type: "bill",
      target_id: "bill",
      target_name: "bill",
      occurrence_date: "2027-01-15",
      planned_amount: 100,
      pending_amount: 100,
      pending_transaction_date: "2027-01-01",
      status: "active",
      created_at: "now",
      updated_at: "now",
    },
  ];
  assert.equal(own(f, checking).endingBalance, 900);
  assert.equal(own(f, billsRef).endingBalance, 500);
});
test("individual history before the account observation remains unavailable, no household close copied", () => {
  const f = fixture();
  f.transactionAccountIdentities[0].updated_at = "2027-01-10T12:00:00Z";
  const result = own(f, checking);
  assert.equal(result.days.length, 31);
  assert.equal(result.days[8].balanceSource, "unavailable");
  assert.ok(Number.isNaN(result.days[8].balance));
  assert.equal(result.days[9].balance, 1000);
  assert.equal(
    own(f, checking, 11, 2026).unavailableReason,
    "Individual account history before its latest balance is unavailable.",
  );
});
test("APY is estimated only for Savings, with optional vs explicit zero and no Activity mutations", () => {
  const f = fixture(),
    before = structuredClone(f);
  const catalog = buildForecastAccountCatalog({
    accounts: [],
    bankAccounts: f.transactionAccountIdentities,
    preferences: [
      {
        household_id: "household",
        account_ref: savings,
        savings_apy: 5,
        safety_floor: null,
        updated_at: "now",
      },
    ],
  });
  const result = buildAccountForecast({
    ref: savings,
    month: 11,
    year: 2027,
    snapshot: f,
    accounts: catalog,
    getEvents: projection(f).getUnanchoredCashEvents,
  });
  assert.ok(Math.abs(result.endingBalance! - 2099.72) < 0.05);
  assert.ok(result.estimatedInterest > 0);
  assert.deepEqual(f, before);
  assert.equal(own(f, savings).estimatedInterest, 0);
});
test("Savings goals are milestones and do not invent a cash deposit", () => {
  const f = fixture();
  f.goals = [
    {
      id: "goal",
      name: "Emergency fund",
      goal_type: "savings",
      target_amount: 3000,
      current_amount: 2000,
      target_date: "2027-01-20",
      created_at: "2027-01-01",
      deposit_account_ref: savings,
    },
  ];
  assert.equal(own(f, savings).endingBalance, 2000);
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1500);
});
test("Savings deposits and contributions route once without changing other accounts", () => {
  const f = fixture();
  f.incomes = [
    {
      id: "income",
      name: "Savings deposit",
      amount: 500,
      frequency: "monthly",
      start_date: "2027-01-20",
      deposit_account_ref: savings,
    },
  ];
  f.decisions = [
    {
      id: "contribution",
      name: "Move to Savings",
      decision_type: "savings_contribution",
      scenario: {
        type: "savings_contribution",
        name: "Move to Savings",
        amount: 200,
        date: "2027-01-12",
        frequency: "once",
      },
      status: "planned",
      created_at: "2027-01-01",
      result: {} as any,
      funding_account_ref: checking,
      deposit_account_ref: savings,
    },
  ];
  assert.equal(own(f, checking).endingBalance, 800);
  assert.equal(own(f, savings).endingBalance, 2700);
  assert.equal(projection(f).getMonthlyIncome(0, 2027), 0);
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1300);
});
test("account-specific unpaid bucket reserves use its own observation even when household anchors differ", () => {
  const f = fixture();
  f.transactionAccountIdentities[0].updated_at = "2027-01-02T12:00:00Z";
  f.transactionAccountIdentities[2].updated_at = "2027-01-03T12:00:00Z";
  f.goals = [
    {
      id: "older",
      name: "Reserved trip",
      goal_type: "planned_expense",
      target_amount: 100,
      current_amount: 0,
      target_date: "2026-12-20",
      created_at: "2026-12-01",
      funding_account_ref: savings,
    },
  ];
  assert.equal(own(f, savings).endingBalance, 1900);
});
test("same-day planned deposits remain projected until actual same-account evidence absorbs them", () => {
  const f = fixture();
  f.incomes = [
    {
      id: "income",
      name: "Payday",
      amount: 500,
      frequency: "monthly",
      start_date: "2027-01-01",
      deposit_account_ref: checking,
    },
  ];
  assert.equal(own(f, checking).endingBalance, 1500);
  f.transactions = [
    {
      id: "posted",
      date: "2027-01-01",
      amount: 500,
      category: "Income",
      note: "Deposit",
      source: "plaid",
      plaid_account_id: "provider-1",
      review_status: "needs_review",
    },
  ];
  assert.equal(own(f, checking).endingBalance, 1000);
});
test("same-merchant same-amount bank charges on different cash accounts remain distinct", () => {
  const f = fixture();
  f.transactions = [
    {
      id: "checking-charge",
      date: "2027-01-02",
      amount: -5,
      category: "Food",
      note: "Merchant",
      source: "plaid",
      plaid_account_id: "provider-1",
    },
    {
      id: "savings-charge",
      date: "2027-01-02",
      amount: -5,
      category: "Food",
      note: "Merchant",
      source: "plaid",
      plaid_account_id: "provider-3",
    },
  ];
  assert.equal(own(f, checking).endingBalance, 995);
  assert.equal(own(f, savings).endingBalance, 1995);
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1495);
});
test("explicit foreign currencies cannot become USD forecast balances or routing targets", () => {
  const f = fixture();
  f.transactionAccountIdentities[2].currency_code = "EUR";
  const result = own(f, savings);
  assert.equal(result.days.length, 0);
  assert.equal(result.account, null);
  assert.ok(result.unavailableReason);
  const catalog = buildForecastAccountCatalog({
    accounts: [],
    bankAccounts: f.transactionAccountIdentities,
  });
  assert.match(
    catalog.find((row) => row.ref === savings)?.unavailableReason ?? "",
    /different currency/,
  );
  assert.equal(resolveForecastAccountReference(savings, catalog), null);
});
test("rollover follows the released payment's explicit account rather than the receiving debt", () => {
  const f = fixture();
  f.transactionAccountIdentities[0].current_balance = 1200;
  f.transactionAccountIdentities[0].available_balance = 1200;
  f.transactionAccountIdentities[1].current_balance = 800;
  f.transactionAccountIdentities[1].available_balance = 800;
  f.bills = [
    { ...bill("finishing", 100, billsRef, true), balance: 50 },
    { ...bill("next", 25, checking, true), priority: 2, balance: 1000 },
  ];
  assert.equal(own(f, checking).endingBalance, 1175);
  assert.equal(own(f, billsRef).endingBalance, 700);
});
test("invalid same-physical-account Savings contribution cannot burn forecast cash or claim completeness", () => {
  const f = fixture();
  f.decisions = [
    {
      id: "self",
      name: "Move to self",
      decision_type: "savings_contribution",
      scenario: {
        type: "savings_contribution",
        name: "Move to self",
        amount: 75,
        date: "2027-01-12",
        frequency: "once",
      },
      status: "planned",
      created_at: "2027-01-01",
      result: {} as any,
      funding_account_ref: checking,
      deposit_account_ref: checking,
    },
  ];
  const result = own(f, checking);
  assert.equal(result.endingBalance, 1000);
  assert.equal(result.complete, false);
  assert.match(result.unassigned[0].name, /different source and destination/);
  assert.equal(projection(f).getDailyBalances(0, 2027).at(-1)?.balance, 1500);
});
test("a Savings-only deposit decision stays outside operating income and future carryover", () => {
  const f = fixture();
  f.decisions = [
    {
      id: "deposit",
      name: "Savings increase",
      decision_type: "income_change",
      scenario: {
        type: "income_change",
        name: "Savings increase",
        amount: 75,
        date: "2027-01-12",
        frequency: "monthly",
      },
      status: "planned",
      created_at: "2027-01-01",
      result: {} as any,
      deposit_account_ref: savings,
    },
  ];
  assert.equal(own(f, savings, 1).endingBalance, 2150);
  assert.equal(projection(f).getDailyBalances(1, 2027).at(-1)?.balance, 1500);
});
test("a legal far-future APY scenario reports an unavailable estimate instead of crashing the account view", () => {
  const f = fixture();
  for (const row of f.transactionAccountIdentities)
    row.updated_at = "2028-02-01T12:00:00Z";
  f.transactionAccountIdentities[2].current_balance = 2400;
  f.transactionAccountIdentities[2].available_balance = 2400;
  const catalog = buildForecastAccountCatalog({
    accounts: [],
    bankAccounts: f.transactionAccountIdentities,
    preferences: [
      {
        household_id: "household",
        account_ref: savings,
        savings_apy: 100,
        safety_floor: null,
        updated_at: "now",
      },
    ],
  });
  let result: ReturnType<typeof buildAccountForecast> | undefined;
  assert.doesNotThrow(() => {
    result = buildAccountForecast({
      ref: savings,
      month: 1,
      year: 2070,
      snapshot: f,
      accounts: catalog,
      getEvents: () => [],
    });
  });
  assert.equal(result!.complete, false);
  assert.equal(result!.days.length, 0);
  assert.equal(result!.endingBalance, null);
  assert.match(result!.unavailableReason!, /supported amount range/);
  assert.equal(catalog.find((row) => row.ref === savings)!.savingsApy, 100);
});
test("forecast coverage excludes ended bills closed buckets and settled manual history",()=>{const f=fixture();f.bills=[{...bill("ended",100),end_date:"2026-12-31"}];f.goals=[{id:"closed",name:"Closed bucket",goal_type:"planned_expense",target_amount:100,current_amount:0,target_date:"2026-12-20",created_at:"2026-01-01",closed_at:"2026-12-25"}];f.transactions=[{id:"old",date:"2026-12-20",amount:-25,category:"Food",note:"Historic manual",source:"manual"}];const result=own(f,checking);assert.deepEqual(result.unassigned,[]);assert.equal(result.complete,true);assert.equal(result.endingBalance,1000);});
test("future coverage retains overdue unpaid obligations but not already-paid current occurrences",()=>{const f=fixture();for(const row of f.transactionAccountIdentities)row.updated_at="2027-01-20T12:00:00Z";f.bills=[bill("rent",100)];assert.equal(own(f,checking).unassigned[0].id,"rent");f.overrides=[{id:"paid",bill_id:"rent",month:0,year:2027,paid_amount:100,paid_date:"2027-01-15"}];assert.deepEqual(own(f,checking).unassigned,[]);assert.equal(own(f,checking,1).unassigned[0].id,"rent");});
test("fully covered pending plans do not demand a redundant account assignment",()=>{const f=fixture();f.bills=[bill("paid-pending",100)];f.pendingBankTransactions=[{plaid_transaction_id:"pending",plaid_account_id:checking.slice(5),transaction_date:"2027-01-01",amount:-100,name:"Charge",category:"Other"}];f.pendingPlanMatches=[{id:"match",pending_plaid_transaction_id:"pending",pending_account_id:checking.slice(5),target_type:"bill",target_id:"paid-pending",target_name:"Paid pending",occurrence_date:"2027-01-15",planned_amount:100,pending_amount:100,pending_transaction_date:"2027-01-01",status:"active",created_at:"now",updated_at:"now"}];const result=own(f,checking);assert.equal(result.endingBalance,900);assert.deepEqual(result.unassigned,[]);assert.equal(own(f,checking,1).unassigned.length,1);});
test("negative income adjustments use the deposit account and do not subtract Savings from operating cash",()=>{const f=fixture();f.decisions=[{id:"lower-income",name:"Income adjustment",decision_type:"income_change",scenario:{type:"income_change",name:"Income adjustment",amount:-100,date:"2027-01-15",frequency:"once"},status:"planned",created_at:"2027-01-01",result:{} as any,deposit_account_ref:savings}];assert.equal(own(f,savings).endingBalance,1900);assert.equal(own(f,checking).endingBalance,1000);assert.equal(projection(f).getDailyBalances(0,2027).at(-1)?.balance,1500);assert.deepEqual(own(f,savings).unassigned,[]);});
test("zero-dollar self contributions create no setup warning or cash impact",()=>{const f=fixture();f.decisions=[{id:"zero",name:"No change",decision_type:"savings_contribution",scenario:{type:"savings_contribution",name:"No change",amount:0,date:"2027-01-15",frequency:"once"},status:"planned",created_at:"2027-01-01",result:{} as any,funding_account_ref:checking,deposit_account_ref:checking}];assert.equal(own(f,checking).endingBalance,1000);assert.deepEqual(own(f,checking).unassigned,[]);});

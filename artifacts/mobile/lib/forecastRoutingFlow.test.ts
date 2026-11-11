import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  buildForecastAccountCatalog,
  resolveForecastAccountReference,
} from "./accountForecasts";
import {
  verifiedRoutingMetadataPatch,
  mergeRoutingMetadata,
} from "./accountNameMetadata";
const source = readFileSync(
    resolve(process.cwd(), "context/BudgetContext.tsx"),
    "utf8",
  ),
  block = source.slice(
    source.indexOf("  const setForecastAccountRoutingBatch ="),
    source.indexOf(
      "  // One shared read-only engine",
      source.indexOf("  const setForecastAccountRoutingBatch ="),
    ),
  );
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(rpc: (name: string, args: any) => Promise<any>) {
  const original = {
    id: "bill",
    amount: 100,
    name: "Original",
    funding_account_ref: null,
  };
  const state = { bills: [original] as any[], pubs: 0, refreshes: [] as any[] };
  const generation = { current: 1 },
    editor = { current: true };
  const setters: any = {};
  for (const key of ["Bills", "Incomes", "Goals", "Decisions", "ExtraPayments"])
    setters[`set${key}`] = (fn: any) => {
      state.pubs++;
      if (key === "Bills") state.bills = fn(state.bills);
      else fn([]);
    };
  const accounts = buildForecastAccountCatalog({
    accounts: [
      {
        id: "checking",
        name: "Checking",
        account_type: "checking",
        current_balance: 1000,
        balance_as_of: "2027-01-01",
        is_active: true,
        created_at: "2027-01-01",
      },
      {
        id: "other",
        name: "Other",
        account_type: "checking",
        current_balance: 500,
        balance_as_of: "2027-01-01",
        is_active: true,
        created_at: "2027-01-01",
      },
    ],
    bankAccounts: [],
  });
  const bindings = {
    useCallback: (fn: any) => fn,
    assertCanEditHousehold: () => {
      if (!editor.current) throw new Error("Read only");
    },
    householdScopeRef: { current: { householdId: "home", budgetId: "budget" } },
    financialScopeGenerationRef: generation,
    userScopeIdRef: { current: "owner" },
    user: { id: "owner" },
    bills: [original],
    incomes: [],
    goals: [],
    decisions: [],
    extraPayments: [],
    forecastAccounts: accounts,
    demoMode: false,
    resolveForecastAccountReference,
    verifiedRoutingMetadataPatch,
    mergeRoutingMetadata,
    supabase: { rpc },
    refreshBankData: async (options: any) => state.refreshes.push(options),
    ...setters,
  };
  const js = ts.transpileModule(block, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const action = new Function(
    ...Object.keys(bindings),
    js + "\nreturn setForecastAccountRoutingBatch;",
  )(...Object.values(bindings));
  return { action, state, generation, editor };
}
const change = [
  {
    entityType: "bill",
    entityId: "bill",
    expected: { funding_account_ref: null },
    patch: { funding_account_ref: "manual:checking" },
  },
];
test("actual batch reply publishes only routing metadata, retaining newer amount/name and a newer route", async () => {
  const response = deferred<any>(),
    h = harness(async () => response.promise);
  const saving = h.action(change);
  await Promise.resolve();
  h.state.bills = [
    {
      ...h.state.bills[0],
      amount: 200,
      name: "Edited",
      funding_account_ref: "manual:other",
    },
  ];
  response.resolve({
    data: {
      results: [
        {
          entity_type: "bill",
          row: {
            id: "bill",
            amount: 100,
            name: "Original",
            funding_account_ref: "manual:checking",
          },
        },
      ],
    },
    error: null,
  });
  await saving;
  assert.equal(h.state.bills[0].amount, 200);
  assert.equal(h.state.bills[0].name, "Edited");
  assert.equal(h.state.bills[0].funding_account_ref, "manual:other");
  assert.deepEqual(h.state.refreshes, [{ savedOnly: true }]);
});
test("a wrong or partial routing receipt publishes no rows", async () => {
  const h = harness(async () => ({
    data: {
      results: [
        {
          entity_type: "bill",
          row: { id: "bill", amount: 100, funding_account_ref: "manual:other" },
        },
      ],
    },
    error: null,
  }));
  await assert.rejects(h.action(change), /verified/);
  assert.equal(h.state.pubs, 0);
  assert.equal(h.state.refreshes.length, 0);
  assert.equal(h.state.bills[0].funding_account_ref, null);
});
test("late household replies and readonly calls cannot publish batch rows", async () => {
  const response = deferred<any>();
  let requests = 0;
  const h = harness(async () => {
    requests++;
    return response.promise;
  });
  const saving = h.action(change);
  await Promise.resolve();
  h.generation.current++;
  response.resolve({
    data: {
      results: [
        {
          entity_type: "bill",
          row: { id: "bill", funding_account_ref: "manual:checking" },
        },
      ],
    },
    error: null,
  });
  await assert.rejects(saving, /household changed/);
  assert.equal(h.state.pubs, 0);
  h.editor.current = false;
  await assert.rejects(h.action(change), /Read only/);
  assert.equal(requests, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  buildForecastAccountCatalog,
  parseForecastAccountRef,
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "./accountForecasts";
import { normalizeConnectedBankRows } from "./financialProjectionInput";
import { enqueueMutationByKeys } from "./financialMutationRecovery";
import {
  mergeAccountNameRead,
  acknowledgeAccountNameRead,
  normalizeAccountDisplayName,
  type AccountNameIntent,
} from "./accountNameMetadata";
const ref = "bank:00000000-0000-4000-8000-000000000001" as ForecastAccountRef;
const source = readFileSync(
  resolve(process.cwd(), "context/BudgetContext.tsx"),
  "utf8",
);
const block = source.slice(
  source.indexOf("  const renameForecastAccount ="),
  source.indexOf("  const reconcileAccount ="),
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(
  rpc: (name: string, payload: any) => Promise<any>,
  suppliedRows?: any[],
  manualAccounts: any[] = [],
) {
  const initial = suppliedRows ?? [
    {
      id: ref.slice(5),
      household_id: "home",
      name: "Bank Checking",
      plaid_account_id: "provider",
      account_type: "depository",
      account_subtype: "checking",
      current_balance: 1000,
      available_balance: 950,
      is_active: true,
      updated_at: "2026-11-11T12:00:00Z",
      mask: "1234",
    },
  ];
  const state = {
    banks: structuredClone(initial) as any[],
    connected: structuredClone(initial) as any[],
    accounts: structuredClone(manualAccounts) as any[],
    publications: 0,
    invalidations: 0,
  };
  const generation = { current: 1 },
    owner = { current: "owner" },
    editor = { current: true };
  const update = (key: "banks" | "connected" | "accounts") => (fn: any) => {
    state[key] = fn(state[key]);
    state.publications++;
  };
  let lastAcknowledgedRows: any[] = [],
    lastAcknowledgedManual: any[] = [];
  const verification = { current: undefined as any[] | undefined };
  const manualVerification = { current: undefined as any[] | undefined };
  const bindings = {
    useCallback: (fn: any) => fn,
    user: { id: "owner" },
    demoMode: false,
    householdScopeRef: { current: { householdId: "home", budgetId: "budget" } },
    financialScopeGenerationRef: generation,
    userScopeIdRef: owner,
    assertCanEditHousehold: () => {
      if (!editor.current) throw new Error("Read only");
    },
    forecastAccounts: buildForecastAccountCatalog({
      accounts: manualAccounts,
      bankAccounts: initial,
    }),
    accounts: manualAccounts,
    transactionAccountIdentities: initial,
    householdTimeZone: "UTC",
    normalizeAccountDisplayName,
    resolveForecastAccountReference,
    parseForecastAccountRef,
    buildForecastAccountCatalog,
    normalizeConnectedBankRows,
    mergeAccountNameRead,
    acknowledgeAccountNameRead,
    enqueueMutationByKeys,
    accountRenameQueuesRef: { current: new Map() },
    accountNameVersionRef: { current: 0 },
    accountNameIntentsRef: { current: [] as AccountNameIntent[] },
    transactionAccountIdentitiesRef: { current: state.banks },
    accountsRef: { current: state.accounts },
    authoritativeAccountsByIdRef: { current: new Map() },
    setTransactionAccountIdentities: update("banks"),
    setConnectedBankAccounts: update("connected"),
    setAccounts: update("accounts"),
    queryClient: { removeQueries: () => state.invalidations++ },
    supabase: {
      rpc: async (name: string, payload: any) => {
        if (name === "get_household_forecast_accounts")
          return {
            data: verification.current ?? lastAcknowledgedRows,
            error: null,
          };
        const response = await rpc(name, payload);
        if (response.data?.bank_accounts)
          lastAcknowledgedRows = response.data.bank_accounts;
        if (response.data?.accounts)
          lastAcknowledgedManual = response.data.accounts;
        return response;
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: manualVerification.current ?? lastAcknowledgedManual,
              error: null,
            }),
          }),
        }),
      }),
    },
  };
  const compiled = ts.transpileModule(block, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const create = (overrides: Record<string, unknown> = {}) => {
    const values = { ...bindings, ...overrides };
    return new Function(
      ...Object.keys(values),
      compiled +
        "\nreturn {renameForecastAccount,updateConnectedBankAccountDisplayName};",
    )(...Object.values(values));
  };
  const api = create();
  const reply = (name: string | null) => ({
    data: {
      account_ref: ref,
      accounts: [],
      bank_accounts: initial.map((row) => ({ ...row, display_name: name })),
    },
    error: null,
  });
  return {
    ...api,
    state,
    generation,
    owner,
    editor,
    reply,
    bindings,
    recreate: create,
    verification,
    manualVerification,
  };
}
test("the real name callback publishes shared names without repainting bank balances or dates", async () => {
  let request: any;
  let h: ReturnType<typeof harness>;
  h = harness(async (_name, payload) => {
    request = payload;
    return h.reply(payload.p_name);
  });
  await h.renameForecastAccount(ref, "  Bills   account  ", "Bank Checking");
  assert.equal(request.p_name, "Bills account");
  assert.equal(request.p_expected_name, "Bank Checking");
  assert.equal(h.state.banks[0].display_name, "Bills account");
  assert.equal(h.state.connected[0].display_name, "Bills account");
  assert.equal(h.state.banks[0].current_balance, 1000);
  assert.equal(h.state.banks[0].available_balance, 950);
  assert.equal(h.state.banks[0].updated_at, "2026-11-11T12:00:00Z");
  assert.equal(h.state.banks[0].plaid_account_id, "provider");
  assert.equal(h.state.banks[0].mask, "1234");
  assert.equal(h.state.invalidations, 1);
});
test("queued stale rename fails without rolling back a newer verified label", async () => {
  const first = deferred<any>(),
    started = deferred<void>();
  let calls = 0;
  const h = harness(async () => {
    calls++;
    if (calls === 1) {
      started.resolve();
      return first.promise;
    }
    return { data: null, error: { message: "This account name changed" } };
  });
  const a = h.renameForecastAccount(ref, "Bills A", "Bank Checking"),
    b = h.renameForecastAccount(ref, "Bills B", "Bank Checking");
  await started.promise;
  assert.equal(calls, 1);
  first.resolve(h.reply("Bills A"));
  await a;
  await assert.rejects(b, /changed/);
  assert.equal(h.state.banks[0].display_name, "Bills A");
  assert.equal(h.state.connected[0].display_name, "Bills A");
});
test("old household replies and viewer actions publish no metadata", async () => {
  const read = deferred<any>(),
    started = deferred<void>();
  let calls = 0;
  const h = harness(async () => {
    calls++;
    started.resolve();
    return read.promise;
  });
  const saving = h.renameForecastAccount(ref, "Bills", "Bank Checking");
  await started.promise;
  h.generation.current++;
  read.resolve(h.reply("Bills"));
  await assert.rejects(saving, /household changed/);
  assert.equal(h.state.publications, 0);
  h.editor.current = false;
  await assert.rejects(
    h.renameForecastAccount(ref, "Bills", "Bank Checking"),
    /Read only/,
  );
  assert.equal(calls, 1);
  assert.equal(h.state.invalidations, 0);
});
test("retained physical aliases serialize renames across a provider active-row switch", async () => {
  const other =
    "bank:00000000-0000-4000-8000-000000000002" as ForecastAccountRef;
  const row = (accountRef: ForecastAccountRef, active: boolean) => ({
    id: accountRef.slice(5),
    household_id: "home",
    name: "Provider",
    plaid_account_id: `provider-${accountRef.slice(-1)}`,
    persistent_account_id: "physical",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: 950,
    is_active: active,
    updated_at: "2026-11-11T12:00:00Z",
  });
  const initial = [row(ref, true), row(other, false)],
    switched = [
      { ...row(ref, false), display_name: "Name A" },
      { ...row(other, true), display_name: "Name A" },
    ],
    first = deferred<any>(),
    started = deferred<void>();
  let calls = 0;
  const h = harness(async () => {
    calls++;
    if (calls === 1) {
      started.resolve();
      return first.promise;
    }
    return {
      data: {
        account_ref: other,
        accounts: [],
        bank_accounts: switched.map((row) => ({
          ...row,
          display_name: "Name B",
        })),
      },
      error: null,
    };
  }, initial);
  const a = h.renameForecastAccount(ref, "Name A", "Provider");
  await started.promise;
  h.state.banks = structuredClone(switched);
  h.bindings.transactionAccountIdentitiesRef.current = h.state.banks;
  const next = h.recreate({
    forecastAccounts: buildForecastAccountCatalog({
      accounts: [],
      bankAccounts: switched,
    }),
    transactionAccountIdentities: switched,
  });
  const b = next.renameForecastAccount(other, "Name B", "Name A");
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve({
    data: {
      account_ref: ref,
      accounts: [],
      bank_accounts: initial.map((row) => ({ ...row, display_name: "Name A" })),
    },
    error: null,
  });
  await a;
  await b;
  assert.equal(calls, 2);
  assert.ok(h.state.banks.every((row: any) => row.display_name === "Name B"));
  assert.equal(
    h.state.banks.find((row: any) => row.id === other.slice(5)).is_active,
    true,
  );
  assert.equal(h.state.banks[0].current_balance, 1000);
});
test("post-acknowledgement metadata verification keeps a newer editor name and fresh balances", async () => {
  const reply = deferred<any>(),
    started = deferred<void>();
  const h = harness(async () => {
    started.resolve();
    return reply.promise;
  });
  const saving = h.renameForecastAccount(ref, "Mine", "Bank Checking");
  await started.promise;
  h.state.banks = [
    {
      ...h.state.banks[0],
      display_name: "Other editor",
      current_balance: 1234,
    },
  ];
  h.verification.current = [{ ...h.state.banks[0], current_balance: 9999 }];
  reply.resolve(h.reply("Mine"));
  await assert.rejects(saving, /changed again/);
  assert.equal(h.state.banks[0].display_name, "Other editor");
  assert.equal(h.state.banks[0].current_balance, 1234);
});
test("a pre-save read does not suppress the subsequently verified successful rename", async () => {
  const reply = deferred<any>(),
    started = deferred<void>();
  const h = harness(async () => {
    started.resolve();
    return reply.promise;
  });
  const saving = h.renameForecastAccount(ref, "Mine", "Bank Checking");
  await started.promise;
  h.bindings.accountNameVersionRef.current++;
  h.bindings.accountNameIntentsRef.current = [
    {
      scope: "owner:home:budget",
      kind: "bank",
      id: ref.slice(5),
      name: null,
      version: h.bindings.accountNameVersionRef.current,
    },
  ];
  reply.resolve(h.reply("Mine"));
  await saving;
  assert.equal(h.state.banks[0].display_name, "Mine");
});
test("separate verification reads cannot publish a torn bank and manual-bridge name snapshot", async () => {
  const manual = {
    id: "manual",
    name: "Original manual",
    account_type: "checking",
    current_balance: 1000,
    balance_as_of: "2026-11-11",
    created_at: "2026-01-01",
    is_active: true,
    household_id: "home",
    budget_id: "budget",
  };
  const bank = {
    id: ref.slice(5),
    name: "Provider",
    household_id: "home",
    flowledger_account_id: "manual",
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 1000,
    available_balance: 950,
    is_active: true,
    updated_at: "2026-11-11T12:00:00Z",
  };
  const h = harness(
    async () => ({
      data: {
        account_ref: ref,
        accounts: [{ id: "manual", name: "Saved" }],
        bank_accounts: [{ ...bank, display_name: "Saved" }],
      },
      error: null,
    }),
    [bank],
    [manual],
  );
  h.verification.current = [{ ...bank, display_name: "Bank A" }];
  h.manualVerification.current = [{ id: "manual", name: "Manual B" }];
  await assert.rejects(
    h.renameForecastAccount(ref, "Saved", "Provider"),
    /changed while being refreshed/,
  );
  assert.equal(h.state.publications, 0);
  assert.equal(h.state.banks[0].display_name, undefined);
  assert.equal(h.state.accounts[0].name, "Original manual");
  assert.equal(h.state.accounts[0].current_balance, 1000);
});

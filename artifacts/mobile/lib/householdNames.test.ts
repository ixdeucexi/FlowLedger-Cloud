import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  acknowledgeHouseholdNameRead,
  mergeHouseholdNameRead,
  normalizeHouseholdName,
} from "./householdNames";
import { canManageHouseholdMembers } from "./householdPermissions";

const home = {
  householdId: "home",
  budgetId: "budget",
  name: "My Household",
  role: "owner",
  isPersonal: true,
};
const other = {
  ...home,
  householdId: "other",
  budgetId: "budget2",
  name: "Cousin",
  isPersonal: false,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function expression(
  source: string,
  start: string,
  end: string,
  variable: string,
  bindings: Record<string, unknown>,
) {
  const block = source.slice(
    source.indexOf(start),
    source.indexOf(end, source.indexOf(start)),
  );
  assert.ok(block.includes(variable));
  const compiled = ts.transpileModule(block + `\nreturn ${variable};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  return new Function("bindings", `with(bindings){${compiled}}`)(bindings);
}
const contextSource = readFileSync("context/BudgetContext.tsx", "utf8");
function contextHarness(
  rpc: (...args: any[]) => Promise<any> = async () => ({
    householdId: "home",
    name: "New home",
  }),
) {
  const state = {
    rows: [{ ...home }, { ...other }],
    writes: 0,
    scope: { ...home },
  };
  const bindings: any = {
    useCallback: (fn: unknown) => fn,
    user: { id: "owner" },
    demoMode: false,
    activeHousehold: state.scope,
    householdScopeRef: { current: state.scope },
    financialScopeGenerationRef: { current: 1 },
    userScopeIdRef: { current: "owner" },
    financialDataUserIdRef: { current: "owner" },
    startupCoreReadyScopeKeyRef: { current: "owner:home" },
    householdRenameInFlightRef: { current: new Set() },
    householdNameVersionRef: { current: 0 },
    householdNameIntentsRef: { current: [] },
    householdsRef: { current: state.rows },
    canManageHouseholdMembers,
    normalizeHouseholdName,
    renameHouseholdRecord: rpc,
    setHouseholds: (update: (rows: any[]) => any[]) => {
      state.rows = update(state.rows);
      state.writes++;
    },
  };
  const rename = expression(
    contextSource,
    "  const renameActiveHousehold =",
    "  const refreshHouseholdsForPrivacy =",
    "renameActiveHousehold",
    bindings,
  );
  return { rename, state, bindings };
}
const serviceSource = readFileSync("lib/households.ts", "utf8");
function serviceHarness(rpc: (name: string, payload: any) => Promise<any>) {
  const block = serviceSource.slice(
    serviceSource.indexOf("export async function renameHousehold("),
    serviceSource.indexOf("export async function loadHouseholdInvites("),
  );
  const javascript = ts.transpileModule(
    block.replace("export async function", "async function") +
      "\nreturn renameHousehold;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  return new Function(
    "supabase",
    "normalizeHouseholdName",
    "friendlyHouseholdError",
    javascript,
  )({ rpc }, normalizeHouseholdName, (message: string, fallback: string) =>
    message?.includes("Only household owners or managers") ? message : fallback,
  );
}

test("household names normalize all supported Unicode whitespace and preserve symbols", () => {
  const spaces =
    " \t\n\r\f\v\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  assert.equal(
    normalizeHouseholdName(spaces + "Cousin's" + spaces + "home & 🏡" + spaces),
    "Cousin's home & 🏡",
  );
  assert.throws(() => normalizeHouseholdName(spaces), /Enter/);
  assert.equal(normalizeHouseholdName("🏡".repeat(80)), "🏡".repeat(80));
  assert.throws(() => normalizeHouseholdName("🏡".repeat(81)), /80/);
  for (const control of ["\0", "\x01", "\x7f", "\x9f"])
    assert.throws(() => normalizeHouseholdName("Home" + control), /letters/);
});
test("stale discovery overlays only a verified name, retaining current role and membership", () => {
  const rows = [{ ...home, role: "viewer" }, { ...other }];
  const before = structuredClone(rows);
  const intent = {
    userId: "owner",
    householdId: "home",
    name: "New home",
    version: 2,
  };
  const merged = mergeHouseholdNameRead(rows, "owner", 1, [intent]);
  assert.equal(merged[0].name, "New home");
  assert.equal(merged[0].role, "viewer");
  assert.equal(merged[0].budgetId, "budget");
  assert.deepEqual(rows, before);
  assert.equal(
    mergeHouseholdNameRead(rows, "other-user", 1, [intent])[0].name,
    home.name,
  );
  assert.deepEqual(
    mergeHouseholdNameRead([other], "owner", 1, [intent]),
    [other],
    "revoked membership not reinserted",
  );
  const newer = acknowledgeHouseholdNameRead(
    [{ ...home, name: "Later from manager" }],
    "owner",
    3,
    [intent],
  );
  assert.equal(
    mergeHouseholdNameRead(rows, "owner", 1, newer)[0].name,
    "Later from manager",
  );
  assert.equal(
    mergeHouseholdNameRead(rows, "owner", 3, newer)[0].name,
    home.name,
    "fresh read may accept a new authoritative name",
  );
});
for (const role of ["owner", "manager"]) {
  test(`${role} context rename changes name only and retains identities`, async () => {
    const calls: any[] = [];
    const h = contextHarness(async (...args) => {
      calls.push(args);
      return { householdId: "home", name: "New home" };
    });
    h.bindings.householdScopeRef.current.role = role;
    h.state.rows[0].role = role;
    await h.rename(" New   home ", home.name);
    assert.deepEqual(calls, [["home", "New home", home.name]]);
    assert.deepEqual(h.state.rows, [
      { ...home, role, name: "New home" },
      other,
    ]);
    assert.equal(h.bindings.householdScopeRef.current.name, "New home");
    assert.equal(h.bindings.householdScopeRef.current.budgetId, "budget");
  });
}
for (const role of ["editor", "viewer", null, undefined]) {
  test(`context denies ${role} role before RPC`, async () => {
    let calls = 0;
    const h = contextHarness(async () => {
      calls++;
      return {};
    });
    h.bindings.householdScopeRef.current.role = role;
    await assert.rejects(
      h.rename("New home", home.name),
      /Only household owners or managers/,
    );
    assert.equal(calls, 0);
    assert.equal(h.state.writes, 0);
  });
}
test("unchanged rename and invalid input send no network request", async () => {
  let calls = 0;
  const h = contextHarness(async () => {
    calls++;
    return {};
  });
  await h.rename(home.name, home.name);
  await assert.rejects(h.rename(" ", home.name), /Enter/);
  assert.equal(calls, 0);
  assert.equal(h.state.writes, 0);
});
for (const change of [
  "signout",
  "household switch",
  "switch away and back",
  "role loss",
]) {
  test(`late RPC does not publish after ${change}`, async () => {
    const pending = deferred<any>();
    const h = contextHarness(() => pending.promise);
    const work = h.rename("New home", home.name);
    if (change === "signout") h.bindings.userScopeIdRef.current = null;
    if (change === "household switch")
      h.bindings.householdScopeRef.current = { ...other };
    if (change === "switch away and back")
      h.bindings.financialScopeGenerationRef.current++;
    if (change === "role loss")
      h.bindings.householdScopeRef.current.role = "viewer";
    pending.resolve({ householdId: "home", name: "New home" });
    await assert.rejects(work, /household or your access changed/);
    assert.equal(h.state.writes, 0);
  });
}
test("context duplicate protection and network failure preserve metadata and allow retry", async () => {
  const pending = deferred<any>();
  let calls = 0;
  const h = contextHarness(() => {
    calls++;
    return pending.promise;
  });
  const work = h.rename("New home", home.name);
  await assert.rejects(h.rename("New home", home.name), /already saving/);
  assert.equal(calls, 1);
  pending.resolve({ householdId: "home", name: "New home" });
  await work;
  assert.equal(h.state.writes, 1);
  const failure = contextHarness(async () => {
    throw new Error("Offline");
  });
  await assert.rejects(failure.rename("New home", home.name), /Offline/);
  assert.equal(failure.state.writes, 0);
  assert.equal(failure.bindings.householdRenameInFlightRef.current.size, 0);
});
test("service submits exact CAS and checks canonical result", async () => {
  const calls: any[] = [];
  const rename = serviceHarness(async (name, payload) => {
    calls.push([name, payload]);
    return { data: { household_id: "home", name: "New home" }, error: null };
  });
  assert.deepEqual(await rename("home", " New   home ", " Original "), {
    householdId: "home",
    name: "New home",
  });
  assert.deepEqual(calls, [
    [
      "rename_household",
      {
        p_household_id: "home",
        p_name: "New home",
        p_expected_name: " Original ",
      },
    ],
  ]);
  for (const data of [
    { household_id: "other", name: "New home" },
    { household_id: "home", name: "Wrong" },
    null,
  ]) {
    await assert.rejects(
      serviceHarness(async () => ({ data, error: null }))(
        "home",
        "New home",
        home.name,
      ),
      /could not be verified/,
    );
  }
  await assert.rejects(
    serviceHarness(async () => ({
      data: null,
      error: { message: "household_name_conflict" },
    }))("home", "New home", home.name),
    /another device/,
  );
});
test("personal household discovery honors stored names without altering personal authorization", async () => {
  const tables: any = {
    household_members: [
      { household_id: "home", role: "owner" },
      { household_id: "other", role: "manager" },
    ],
    households: [
      { id: "home", name: "Named personal", is_personal: true },
      { id: "other", name: "Cousin", is_personal: false },
    ],
    budgets: [
      { id: "budget", household_id: "home", is_default: true },
      { id: "budget2", household_id: "other", is_default: true },
    ],
  };
  const supabase = {
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({ data: tables[table], error: null }),
        in: async () => ({ data: tables[table], error: null }),
      }),
    }),
  };
  const javascript = ts.transpileModule(
    serviceSource
      .slice(
        serviceSource.indexOf(
          "export async function loadHouseholdMemberships(",
        ),
        serviceSource.indexOf("/** Name-only endpoint"),
      )
      .replace("export async function", "async function") +
      "\nreturn loadHouseholdMemberships;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const load = new Function(
    "supabase",
    "normalizeHouseholdRole",
    "ownsLegacyPersonalRows",
    "HouseholdDiscoveryError",
    javascript,
  )(
    supabase,
    (role: unknown) => role,
    (row: any) => row.isPersonal && row.role === "owner",
    Error,
  );
  const result = await load("owner");
  assert.equal(result[0].name, "Named personal");
  assert.equal(result[0].isPersonal, true);
  assert.equal(result[0].role, "owner");
  assert.equal(result[1].name, "Cousin");
  assert.equal(result[1].isPersonal, false);
});

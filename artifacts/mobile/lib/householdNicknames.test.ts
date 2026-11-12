import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  acknowledgeHouseholdNicknameRead,
  householdDisplayName,
  mergeHouseholdNicknameRead,
  normalizeHouseholdName,
} from "./householdNames";
import { parseBudgetPlanCache } from "./budgetPlanCache";
const home = {
  householdId: "home",
  budgetId: "budget",
  name: "My Household",
  nickname: null as string | null,
  nicknameReady: true,
  nicknameError: null as string | null,
  isPersonal: false,
  role: "editor",
};
const other = {
  ...home,
  householdId: "other",
  budgetId: "budget2",
  role: "owner",
};
const contextSource = readFileSync("context/BudgetContext.tsx", "utf8"),
  serviceSource = readFileSync("lib/households.ts", "utf8");
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function extract(
  source: string,
  start: string,
  end: string,
  variable: string,
  bindings: Record<string, unknown>,
) {
  const begin = source.indexOf(start),
    finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin);
  const block = source
    .slice(begin, finish)
    .replace(/export async function/g, "async function");
  const javascript = ts.transpileModule(block + `\nreturn ${variable};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  return new Function("bindings", `with(bindings){${javascript}}`)(bindings);
}
function harness(
  rpc: (
    userId: string,
    householdId: string,
    nickname: string | null,
    expected: string | null,
  ) => Promise<any> = async (_u, h, n) => ({ householdId: h, nickname: n }),
  load: () => Promise<Map<string, string>> = async () => new Map(),
) {
  const state = { rows: [{ ...home }, { ...other }], writes: 0 };
  const b: any = {
    useCallback: (fn: unknown) => fn,
    user: { id: "owner" },
    demoMode: false,
    activeHousehold: state.rows[0],
    householdScopeRef: { current: state.rows[0] },
    financialScopeGenerationRef: { current: 1 },
    userScopeIdRef: { current: "owner" },
    financialDataUserIdRef: { current: "owner" },
    startupCoreReadyScopeKeyRef: { current: "owner:home" },
    householdsRef: { current: state.rows },
    householdNicknameInFlightRef: { current: new Set() },
    householdNicknameVersionRef: { current: 0 },
    householdNicknameIntentsRef: { current: [] },
    normalizeHouseholdName,
    mergeHouseholdNicknameRead,
    acknowledgeHouseholdNicknameRead,
    saveHouseholdNicknameRecord: rpc,
    loadHouseholdNicknames: load,
    setHouseholds: (fn: (rows: any[]) => any[]) => {
      state.rows = fn(state.rows);
      state.writes++;
    },
  };
  const save = extract(
    contextSource,
    "  const saveActiveHouseholdNickname =",
    "  const renameActiveHousehold =",
    "saveActiveHouseholdNickname",
    b,
  );
  const refresh = extract(
    contextSource,
    "  const refreshHouseholdNicknames =",
    "  const saveActiveHouseholdNickname =",
    "refreshHouseholdNicknames",
    b,
  );
  return { state, b, save, refresh };
}

test("private display helper leaves raw shared name intact and safely ignores invalid metadata", () => {
  const row = { ...home, nickname: " Cousin's   home 🏡 " };
  assert.equal(householdDisplayName(row), "Cousin's home 🏡");
  assert.equal(row.name, "My Household");
  assert.equal(
    householdDisplayName({ ...row, nickname: null }),
    "My Household",
  );
  assert.equal(
    householdDisplayName({ ...row, nickname: "\x01" }),
    "My Household",
  );
});
test("failed nickname reads retain known display and block editing without altering scope", () => {
  const known = { ...home, nickname: "Cousin" };
  const read = {
    ...home,
    nickname: undefined,
    nicknameReady: false,
    nicknameError: "Offline",
  };
  const result = mergeHouseholdNicknameRead([read], "owner", 2, [], [known])[0];
  assert.equal(result.nickname, "Cousin");
  assert.equal(result.nicknameReady, false);
  assert.equal(result.name, "My Household");
  assert.equal(result.budgetId, "budget");
});
test("set/remove tombstones protect older remote reads and cached household lists", () => {
  for (const nickname of ["Cousin", null]) {
    const intent = {
      userId: "owner",
      householdId: "home",
      nickname,
      version: 3,
    };
    const stale = { ...home, nickname: "Old nickname" };
    assert.equal(
      mergeHouseholdNicknameRead([stale], "owner", 1, [intent])[0].nickname,
      nickname,
    );
    const cached = mergeHouseholdNicknameRead(
      [stale],
      "owner",
      -1,
      [intent],
      [{ ...home, nickname, nicknameReady: false, nicknameError: "Offline" }],
      true,
    )[0];
    assert.equal(cached.nickname, nickname);
    assert.equal(cached.nicknameReady, false);
    assert.equal(cached.nicknameError, "Offline");
    assert.equal(
      mergeHouseholdNicknameRead([stale], "other-user", 1, [intent])[0]
        .nickname,
      "Old nickname",
    );
  }
});
for (const role of ["owner", "manager", "editor", "viewer"]) {
  test(`${role} can set own nickname while shared identity and other household stay intact`, async () => {
    const calls: any[] = [];
    const h = harness(async (...args) => {
      calls.push(args);
      return { householdId: "home", nickname: "Cousin" };
    });
    h.b.householdScopeRef.current.role = role;
    await h.save(" Cousin ", null);
    assert.deepEqual(calls, [["owner", "home", "Cousin", null]]);
    assert.equal(h.state.rows[0].nickname, "Cousin");
    assert.equal(h.state.rows[0].name, "My Household");
    assert.equal(h.state.rows[0].role, role);
    assert.deepEqual(h.state.rows[1], other);
  });
}
test("explicit clear records a null tombstone and exposes latest shared name", async () => {
  const h = harness();
  h.state.rows[0].nickname = "Cousin";
  h.state.rows[0].name = "Shared renamed elsewhere";
  await h.save(null, "Cousin");
  assert.equal(h.state.rows[0].nickname, null);
  assert.equal(
    householdDisplayName(h.state.rows[0]),
    "Shared renamed elsewhere",
  );
  assert.equal(h.b.householdNicknameIntentsRef.current[0].nickname, null);
});
test("unknown nickname read blocks writes; unchanged/cancel-equivalent action does not write", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return {};
  });
  h.state.rows[0].nicknameReady = false;
  await assert.rejects(h.save("Cousin", null), /Reload/);
  assert.equal(calls, 0);
  h.state.rows[0].nicknameReady = true;
  await h.save(null, null);
  assert.equal(calls, 0);
});
for (const change of [
  "signout",
  "switch",
  "switch back",
  "membership removed",
]) {
  test(`late nickname ACK cannot publish after ${change}`, async () => {
    const pending = deferred<any>(),
      h = harness(() => pending.promise),
      work = h.save("Cousin", null);
    if (change === "signout") h.b.userScopeIdRef.current = null;
    if (change === "switch") h.b.householdScopeRef.current = { ...other };
    if (change === "switch back") h.b.financialScopeGenerationRef.current++;
    if (change === "membership removed") h.b.householdsRef.current = [other];
    pending.resolve({ householdId: "home", nickname: "Cousin" });
    await assert.rejects(work, /household changed/i);
    assert.equal(h.state.writes, 0);
  });
}
test("duplicate save only sends one call and a failed save leaves old nickname intact", async () => {
  const pending = deferred<any>();
  let calls = 0;
  const h = harness(() => {
    calls++;
    return pending.promise;
  });
  const work = h.save("Cousin", null);
  await assert.rejects(h.save("Other", null), /already saving/);
  assert.equal(calls, 1);
  pending.resolve({ householdId: "home", nickname: "Cousin" });
  await work;
  const failed = harness(async () => {
    throw Error("Offline");
  });
  await assert.rejects(failed.save("Cousin", null), /Offline/);
  assert.equal(failed.state.rows[0].nickname, null);
  assert.equal(failed.state.writes, 0);
  assert.equal(failed.b.householdNicknameInFlightRef.current.size, 0);
});
test("nickname read retry changes metadata only and failed read preserves known nickname", async () => {
  const h = harness(undefined, async () => {
    throw Error("Offline");
  });
  h.state.rows[0].nickname = "Known";
  await assert.rejects(h.refresh(), /could not be loaded/);
  assert.equal(h.state.rows[0].nickname, "Known");
  assert.equal(h.state.rows[0].nicknameReady, false);
  assert.equal(h.state.rows[0].name, "My Household");
  const success = harness(undefined, async () => new Map([["home", "Fresh"]]));
  await success.refresh();
  assert.equal(success.state.rows[0].nickname, "Fresh");
  assert.equal(success.state.rows[1].nickname, null);
});
test("out-of-order metadata reads cannot overwrite a newer nickname result", async () => {
  const first = deferred<Map<string, string>>(),
    second = deferred<Map<string, string>>();
  let calls = 0;
  const h = harness(undefined, () =>
    ++calls === 1 ? first.promise : second.promise,
  );
  const a = h.refresh(),
    b = h.refresh();
  second.resolve(new Map([["home", "Newer"]]));
  await b;
  first.resolve(new Map([["home", "Older"]]));
  await a;
  assert.equal(h.state.rows[0].nickname, "Newer");
});
test("service enforces actor identity, raw CAS baseline and canonical nickname result", async () => {
  const calls: any[] = [];
  const save = extract(
    serviceSource,
    "export async function saveHouseholdNickname(",
    "/** Name-only endpoint",
    "saveHouseholdNickname",
    {
      supabase: {
        rpc: async (name: string, payload: any) => {
          calls.push([name, payload]);
          return {
            data: {
              user_id: "owner",
              household_id: "home",
              nickname: "Cousin",
            },
            error: null,
          };
        },
      },
      normalizeHouseholdName,
    },
  );
  await save("owner", "home", " Cousin ", "Old");
  assert.deepEqual(calls, [
    [
      "save_household_nickname",
      {
        p_household_id: "home",
        p_nickname: "Cousin",
        p_expected_nickname: "Old",
      },
    ],
  ]);
  const bad = extract(
    serviceSource,
    "export async function saveHouseholdNickname(",
    "/** Name-only endpoint",
    "saveHouseholdNickname",
    {
      supabase: {
        rpc: async () => ({
          data: { user_id: "other", household_id: "home", nickname: "Cousin" },
          error: null,
        }),
      },
      normalizeHouseholdName,
    },
  );
  await assert.rejects(
    bad("owner", "home", "Cousin", null),
    /could not be verified/,
  );
});
test("nickname query scopes reads to the current user and discovered household IDs", async () => {
  const calls: any[] = [];
  const builder: any = {
    select: (value: string) => {
      calls.push(["select", value]);
      return builder;
    },
    eq: (...args: any[]) => {
      calls.push(["eq", ...args]);
      return builder;
    },
    in: (...args: any[]) => {
      calls.push(["in", ...args]);
      return builder;
    },
    abortSignal: async () => ({
      data: [{ user_id: "owner", household_id: "home", nickname: "Cousin" }],
      error: null,
    }),
  };
  const load = extract(
    serviceSource,
    "export async function loadHouseholdNicknames(",
    "export async function saveHouseholdNickname(",
    "loadHouseholdNicknames",
    {
      supabase: {
        from: (table: string) => {
          calls.push(["from", table]);
          return builder;
        },
      },
      normalizeHouseholdName,
    },
  );
  assert.deepEqual(
    await load("owner", ["home"]),
    new Map([["home", "Cousin"]]),
  );
  assert.ok(
    calls.some(
      (row) => row[0] === "eq" && row[1] === "user_id" && row[2] === "owner",
    ),
  );
  assert.ok(
    calls.some(
      (row) =>
        row[0] === "in" && row[1] === "household_id" && row[2][0] === "home",
    ),
  );
});
test("legacy cache remains valid; invalid nickname metadata does not invalidate the financial plan", () => {
  const source = readFileSync("lib/budgetPlanCache.test.ts", "utf8");
  const fn = extract(
    source,
    "function record(",
    "function memoryStorage(",
    "record",
    {},
  );
  const record = fn();
  const old = parseBudgetPlanCache(
    JSON.stringify(record),
    record.userId,
    record.household.householdId,
  );
  assert.ok(old);
  record.household.nickname = "\x01";
  record.households[0].nickname = "\x01";
  const clean = parseBudgetPlanCache(
    JSON.stringify(record),
    record.userId,
    record.household.householdId,
  );
  assert.ok(clean);
  assert.equal(clean.household.nickname, undefined);
  assert.deepEqual(clean.data, record.data);
});

test("nickname read failure does not fail actual household and budget discovery", async () => {
  const tables: any = {
    household_members: [{ household_id: "home", role: "editor" }],
    households: [{ id: "home", name: "My Household", is_personal: false }],
    budgets: [{ id: "budget", household_id: "home", is_default: true }],
  };
  const query = (table: string) => ({
    select: () => ({
      eq: async () => ({ data: tables[table], error: null }),
      in: async () => ({ data: tables[table], error: null }),
    }),
  });
  const load = extract(
    serviceSource,
    "export async function loadHouseholdMemberships(",
    "/** Failed nickname reads",
    "loadHouseholdMemberships",
    {
      supabase: { from: query },
      normalizeHouseholdRole: (value: unknown) => value,
      ownsLegacyPersonalRows: () => false,
      HouseholdDiscoveryError: Error,
      loadHouseholdNicknames: async () => {
        throw Error("Nickname read unavailable");
      },
    },
  );
  const result = await load("owner");
  assert.equal(result[0].householdId, "home");
  assert.equal(result[0].budgetId, "budget");
  assert.equal(result[0].nicknameReady, false);
  assert.match(result[0].nicknameError, /could not be loaded/);
});

test("optional nickname GET aborts at its bounded deadline and clears the timer", async () => {
  let abort!: () => void,
    cleared = false,
    deadline = 0;
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    abortSignal: (signal: AbortSignal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () =>
          resolve({ data: null, error: { message: "Aborted" } }),
        ),
      ),
  };
  const load = extract(
    serviceSource,
    "export async function loadHouseholdNicknames(",
    "export async function saveHouseholdNickname(",
    "loadHouseholdNicknames",
    {
      supabase: { from: () => builder },
      normalizeHouseholdName,
      setTimeout: (callback: () => void, ms: number) => {
        abort = callback;
        deadline = ms;
        return 1;
      },
      clearTimeout: () => {
        cleared = true;
      },
    },
  );
  const work = load("owner", ["home"]);
  abort();
  await assert.rejects(work, /could not be loaded/);
  assert.equal(deadline, 3500);
  assert.equal(cleared, true);
});

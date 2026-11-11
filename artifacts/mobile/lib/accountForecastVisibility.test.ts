import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  parseForecastAccountRef,
  resolveForecastAccountReference,
  type ForecastAccountRef,
} from "./accountForecasts";
const source = readFileSync(
  resolve(process.cwd(), "context/BudgetContext.tsx"),
  "utf8",
);
const body = source.slice(
  source.indexOf("  const accountForecastScopeKey ="),
  source.indexOf("  const saveAccountForecastPreference ="),
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(
  read: Promise<string | null>,
  shared?: {
    current: {
      scope: string | null;
      version: number;
      refs: ForecastAccountRef[];
      ready: boolean;
    };
  },
  owner = "owner",
  options: {
    catalog?: any[];
    stored?: ForecastAccountRef[];
    selected?: ForecastAccountRef;
  } = {},
) {
  const state = {
    hidden: [] as ForecastAccountRef[],
    selected: null,
    preferences: [],
    scope: null,
    error: null,
  };
  const writes: { key: string; refs: ForecastAccountRef[] }[] = [];
  const visibility = shared ?? {
    current: { scope: null, version: 0, refs: [], ready: false },
  };
  const catalog =
    options.catalog ??
    ["manual:checking", "manual:bills", "manual:savings"].map((ref) => ({
      ref,
      active: true,
      aliases: [ref],
    }));
  let cleanup = () => {};
  const set = (key: keyof typeof state) => (value: any) => {
    (state as any)[key] =
      typeof value === "function" ? value((state as any)[key]) : value;
  };
  const bindings = {
    user: { id: owner },
    activeHousehold: { householdId: "home", budgetId: "budget" },
    demoMode: false,
    useEffect: (fn: () => () => void) => {
      cleanup = fn();
    },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    setSelectedForecastAccountRef: set("selected"),
    setHiddenForecastAccountRefs: set("hidden"),
    setAccountForecastPreferences: set("preferences"),
    setAccountForecastPreferenceScope: set("scope"),
    setAccountForecastError: set("error"),
    AsyncStorage: {
      getItem: () => read,
      setItem: async (key: string, value: string) => {
        writes.push({ key, refs: JSON.parse(value) });
      },
    },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    },
    parseForecastAccountRef,
    resolveForecastAccountReference,
    normalizeAccountForecastPreference: () => null,
    buildForecastAccountCatalog: () => catalog,
    transactionForecastAccountRef: () => null,
    accounts: [],
    transactionAccountIdentities: [],
    accountForecastPreferences: [],
    accountForecastPreferenceScope: null,
    householdTimeZone: "UTC",
    loading: false,
    loadError: null,
    storedHiddenForecastAccountRefs: options.stored ?? [],
    forecastVisibilityReadyScope: null,
    setForecastVisibilityReadyScope: () => undefined,
    setForecastVisibilityError: () => undefined,
    selectedForecastAccountRef: options.selected ?? null,
    forecastVisibilityStateRef: visibility,
    forecastVisibilityWriteRef: { current: Promise.resolve() },
  };
  const js = ts.transpileModule(body, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const api = new Function(
    ...Object.keys(bindings),
    `${js}\nreturn {setAccountForecastVisible, hiddenForecastAccountRefs};`,
  )(...Object.values(bindings)) as {
    hiddenForecastAccountRefs: ForecastAccountRef[];
    setAccountForecastVisible: (
      ref: ForecastAccountRef,
      visible: boolean,
    ) => Promise<void>;
  };
  return { ...api, state, writes, visibility, cleanup: () => cleanup() };
}
test("display switches wait for stored choices so an early hide cannot erase another hidden account", async () => {
  const read = deferred<string | null>(),
    h = harness(read.promise);
  await assert.rejects(
    h.setAccountForecastVisible("manual:savings", false),
    /loading/,
  );
  assert.equal(h.writes.length, 0);
  read.resolve('["manual:checking"]');
  await Promise.resolve();
  await Promise.resolve();
  await h.setAccountForecastVisible("manual:savings", false);
  assert.deepEqual(h.state.hidden, ["manual:checking", "manual:savings"]);
  assert.deepEqual(h.writes.at(-1)?.refs, [
    "manual:checking",
    "manual:savings",
  ]);
});
test("rapid account switches combine latest intent and persist the same scoped choices", async () => {
  const h = harness(Promise.resolve(null));
  await Promise.resolve();
  const first = h.setAccountForecastVisible("manual:checking", false),
    second = h.setAccountForecastVisible("manual:savings", false);
  await Promise.all([first, second]);
  assert.deepEqual(h.state.hidden, ["manual:checking", "manual:savings"]);
  assert.deepEqual(h.writes.at(-1), {
    key: "flowledger:forecast-visibility:owner:home:budget",
    refs: ["manual:checking", "manual:savings"],
  });
  await h.setAccountForecastVisible("manual:checking", true);
  assert.deepEqual(h.state.hidden, ["manual:savings"]);
});
test("old owner hydration cannot publish into the new owner's display settings", async () => {
  const read = deferred<string | null>(),
    old = harness(read.promise);
  old.cleanup();
  const current = harness(
    Promise.resolve(null),
    old.visibility,
    "different-owner",
  );
  await Promise.resolve();
  await current.setAccountForecastVisible("manual:bills", false);
  read.resolve('["manual:savings"]');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(current.state.hidden, ["manual:bills"]);
  assert.deepEqual(old.state.hidden, []);
  assert.match(current.writes[0].key, /different-owner:home:budget$/);
});
test("reconnected account aliases keep personal visibility and clear a selected old alias", async () => {
  const old = "bank:00000000-0000-4000-8000-000000000001" as ForecastAccountRef,
    current = "bank:00000000-0000-4000-8000-000000000002" as ForecastAccountRef;
  const h = harness(
    Promise.resolve(JSON.stringify([old])),
    undefined,
    "owner",
    {
      catalog: [{ ref: current, active: true, aliases: [old, current] }],
      stored: [old],
      selected: old,
    },
  );
  assert.deepEqual(h.hiddenForecastAccountRefs, [current]);
  await Promise.resolve();
  await h.setAccountForecastVisible(current, true);
  assert.deepEqual(h.state.hidden, []);
  assert.deepEqual(h.writes.at(-1)?.refs, []);
  await h.setAccountForecastVisible(current, false);
  assert.deepEqual(h.state.hidden, [current]);
  assert.equal(h.state.selected, null);
});

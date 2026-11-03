import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

type Calendar = { month: number; year: number; selectedDate?: string };
type Preferences = { calendar?: Calendar };
type Route = { openDate?: string | string[]; openDateAt?: string | string[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const source = readFileSync("app/(tabs)/monthly.tsx", "utf8").replace(/\r\n/g, "\n");
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Actual calendar source block: ${start}`);
  return source.slice(from, to);
}

// Execute production hooks and callbacks. Only React's scheduler and the storage
// boundary are simulated; hydration and navigation logic come from monthly.tsx.
function calendar(options: {
  warm?: boolean;
  desktop?: boolean;
  scope?: [string, string] | null;
  route?: Route;
  runtimeScopes?: Set<string>;
} = {}) {
  const slots: any[] = [];
  const pendingEffects = new Map<number, () => void>();
  const reads: Array<{ user: string; household: string; gate: ReturnType<typeof deferred<Preferences>> }> = [];
  const writes: Array<{ user: string; household: string; calendar: Calendar }> = [];
  const runtimeScopes = options.runtimeScopes ?? new Set<string>();
  let scope = options.scope === undefined ? ["user-a", "home-a"] : options.scope;
  if (options.warm && scope) runtimeScopes.add(scope.join(":"));
  let route: Route = options.route ?? {};
  let cursor = 0;
  let dirty = false;
  let value: any;
  const equal = (a: any[], b: any[]) => a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = {
    useState(initial: any) {
      const i = cursor++;
      if (!slots[i]) {
        const slot: any = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (next: any) => {
          const resolved = typeof next === "function" ? next(slot.value) : next;
          if (!Object.is(resolved, slot.value)) { slot.value = resolved; dirty = true; }
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(fn: () => any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn: any, deps: any[]) {
      return hooks.useMemo(() => fn, deps);
    },
    useEffect(effect: () => (() => void) | void, deps: any[]) {
      const i = cursor++;
      const old = slots[i];
      if (!old || !equal(old.deps, deps)) {
        slots[i] = { deps, cleanup: old?.cleanup };
        pendingEffects.set(i, () => {
          slots[i].cleanup?.();
          slots[i].cleanup = effect();
        });
      }
    },
  };
  const monthSearchState = between("  const [monthSearchVisible,", "  useBackDismiss(txModalVisible");
  const stateAndEffects = between("  const [selectedDate, setSelectedDate]", "  useFocusEffect(");
  const actions = between("  const changeMonth =", "  const openPlannedDebtPaymentEditor =");
  const script = transpileModule(`
    ${between("const MONTH_FULL =", "const FREQ_LABELS:")}
    ${between("function isoDateForMonthDay(", "function dayFromIsoDate(")}
    return function renderCalendar() {
      const [month, setMonth] = useState(householdCurrentMonth);
      const [selectedYear, setSelectedYear] = useState(householdCurrentYear);
      ${stateAndEffects}
      ${monthSearchState}
      ${actions}
      return {month, selectedYear, selectedDate, monthSearchVisible, monthSearchQuery,
        monthSearchYear, changeMonth, jumpToToday, openMonthSearch, closeMonthSearch,
        chooseMonthFromSearch, changeSearchYear, selectCalendarDate, markCalendarInteraction,
        setMonth, setSelectedYear, setSelectedDate};
    };
  `, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.React } }).outputText;
  const environment: Record<string, any> = {
    ...hooks,
    user: scope ? { id: scope[0] } : null,
    activeHousehold: scope ? { householdId: scope[1] } : null,
    routeParams: route,
    householdCurrentMonth: 10,
    householdCurrentYear: 2026,
    householdAsOfDate: "2026-11-03",
    isDesktop: options.desktop ?? false,
    calendarRuntimeScopes: runtimeScopes,
    Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Light: "light" } },
    Keyboard: { dismiss() {} },
    PanResponder: { create: (handlers: unknown) => handlers },
    readInterfacePreferences(user: string, household: string) {
      const gate = deferred<Preferences>();
      reads.push({ user, household, gate });
      return gate.promise;
    },
    updateInterfacePreferences(user: string, household: string, update: Preferences) {
      writes.push({ user, household, calendar: structuredClone(update.calendar!) });
      return Promise.resolve();
    },
  };
  const compiled = new Function("environment", `with (environment) { ${script} }`)(environment);
  const flushEffects = () => {
    while (pendingEffects.size) {
      const next = [...pendingEffects.values()];
      pendingEffects.clear();
      next.forEach(effect => effect());
    }
  };
  const render = (effects = true) => {
    cursor = 0;
    dirty = false;
    environment.user = scope ? { id: scope[0] } : null;
    environment.activeHousehold = scope ? { householdId: scope[1] } : null;
    environment.routeParams = route;
    value = compiled();
    if (effects) flushEffects();
    return value;
  };
  const flush = () => {
    for (let count = 0; dirty && count < 20; count++) render();
    assert.equal(dirty, false, "Calendar hooks settled without a render loop");
    return value;
  };
  const settle = async () => {
    for (let count = 0; count < 12; count++) { await Promise.resolve(); flush(); }
    return value;
  };
  render();
  flush();
  return {
    reads, writes, runtimeScopes,
    get value() { return flush(); },
    render,
    flushEffects,
    settle,
    scope(next: [string, string] | null, effects = true) { scope = next; render(effects); if (effects) flush(); },
    route(next: Route, effects = true) { route = next; render(effects); if (effects) flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

const saved: Preferences = { calendar: { month: 3, year: 2025, selectedDate: "2025-04-12" } };
const snapshot = (value: any): Calendar => ({ month: value.month, year: value.selectedYear, ...(value.selectedDate ? { selectedDate: value.selectedDate } : {}) });

test("late cold and warm hydration preserve newer month navigation and day selection, then persist the latest choice", async () => {
  for (const warm of [false, true]) {
    const h = calendar({ warm });
    h.value.changeMonth(1);
    h.value.selectCalendarDate("2026-12-18");
    assert.equal(h.writes.length, 0);
    h.reads[0].gate.resolve(saved);
    await h.settle();
    assert.deepEqual(snapshot(h.value), { month: 11, year: 2026, selectedDate: "2026-12-18" });
    assert.deepEqual(h.writes, [{ user: "user-a", household: "home-a", calendar: snapshot(h.value) }]);
    h.unmount();
  }
});

test("a day choice or Today during pending hydration survives even when the month does not change", async () => {
  for (const action of ["day", "today"] as const) {
    const h = calendar({ warm: true });
    if (action === "day") h.value.selectCalendarDate("2026-11-17");
    else h.value.jumpToToday();
    h.reads[0].gate.resolve(saved);
    await h.settle();
    const selectedDate = action === "day" ? "2026-11-17" : "2026-11-03";
    assert.deepEqual(snapshot(h.value), { month: 10, year: 2026, selectedDate });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].calendar, snapshot(h.value));
    h.unmount();
  }
});

test("untouched cold calendar starts in the current month and untouched warm calendar restores saved navigation", async () => {
  for (const warm of [false, true]) {
    const h = calendar({ warm });
    h.reads[0].gate.resolve(saved);
    await h.settle();
    assert.deepEqual(snapshot(h.value), warm ? saved.calendar : { month: 10, year: 2026 });
    assert.deepEqual(h.writes.map(write => write.calendar), [snapshot(h.value)]);
    h.unmount();
  }
});

test("explicit dates and new route tokens take precedence over pending preference reads", async () => {
  const h = calendar({ warm: true, route: { openDate: "2028-02-29", openDateAt: "first" } });
  assert.deepEqual(snapshot(h.value), { month: 1, year: 2028, selectedDate: "2028-02-29" });
  const stale = h.reads[0];
  h.route({ openDate: "2029-06-22", openDateAt: "second" });
  stale.gate.resolve(saved);
  await h.settle();
  assert.deepEqual(snapshot(h.value), { month: 5, year: 2029, selectedDate: "2029-06-22" });
  assert.equal(h.writes.length, 0);
  h.reads.at(-1)!.gate.resolve(saved);
  await h.settle();
  assert.deepEqual(h.writes.map(write => write.calendar), [{ month: 5, year: 2029, selectedDate: "2029-06-22" }]);
  h.unmount();
});

test("old scope completions are inert after A to B to A renders, including before effect cleanup", async () => {
  const h = calendar({ warm: true });
  const stale = h.reads[0];
  h.scope(["user-b", "home-b"], false);
  h.scope(["user-a", "home-a"], false);
  stale.gate.resolve(saved);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(snapshot(h.value), { month: 10, year: 2026 });
  assert.equal(h.writes.length, 0);
  h.flushEffects();
  h.reads.at(-1)!.gate.resolve({ calendar: { month: 7, year: 2027 } });
  await h.settle();
  assert.deepEqual(snapshot(h.value), { month: 7, year: 2027 });
  assert.ok(h.writes.every(write => write.user === "user-a" && write.household === "home-a"));
  h.unmount();
});

test("changing household or user cancels stale hydration and writes only the destination view", async () => {
  for (const destination of [["user-a", "home-b"], ["user-b", "home-a"]] as Array<[string, string]>) {
    const h = calendar({ warm: true });
    const stale = h.reads[0];
    h.scope(destination);
    stale.gate.resolve(saved);
    await h.settle();
    assert.equal(h.writes.length, 0);
    h.reads.at(-1)!.gate.resolve({ calendar: { month: 7, year: 2027 } });
    await h.settle();
    assert.deepEqual(snapshot(h.value), { month: 10, year: 2026 }, "The destination is a cold calendar scope");
    assert.deepEqual(h.writes, [{ user: destination[0], household: destination[1], calendar: { month: 10, year: 2026 } }]);
    h.scope(null);
    h.value.changeMonth(1);
    await h.settle();
    assert.equal(h.writes.length, 1, "No signed-in destination means no preference write");
    h.unmount();
  }
});

test("month search year browsing stays local, cancel preserves the view, and choosing commits the draft year", async () => {
  const h = calendar({ warm: true });
  h.reads[0].gate.resolve(saved);
  await h.settle();
  const before = snapshot(h.value);
  const writesBefore = h.writes.length;
  h.value.openMonthSearch();
  h.value.changeSearchYear(1);
  h.value.changeSearchYear(1);
  assert.equal(h.value.monthSearchYear, 2027);
  assert.deepEqual(snapshot(h.value), before);
  assert.equal(h.writes.length, writesBefore);
  h.value.closeMonthSearch();
  assert.equal(h.value.monthSearchVisible, false);
  assert.deepEqual(snapshot(h.value), before);
  h.value.openMonthSearch();
  assert.equal(h.value.monthSearchYear, 2025, "Reopening begins at the actual viewed year");
  h.value.changeSearchYear(3);
  h.value.chooseMonthFromSearch(8);
  assert.deepEqual(snapshot(h.value), { month: 8, year: 2028 });
  assert.equal(h.value.monthSearchVisible, false);
  assert.deepEqual(h.writes.at(-1)!.calendar, { month: 8, year: 2028 });
  h.unmount();
});

test("a committed month search selection protects its chosen view while preferences are pending", async () => {
  const h = calendar({ warm: true });
  h.value.openMonthSearch();
  h.value.changeSearchYear(2);
  h.value.chooseMonthFromSearch(6);
  h.reads[0].gate.resolve(saved);
  await h.settle();
  assert.deepEqual(snapshot(h.value), { month: 6, year: 2028 });
  assert.deepEqual(h.writes.map(write => write.calendar), [{ month: 6, year: 2028 }]);
  h.unmount();
});

test("a previous ready scope cannot enable writes when that same scope is revisited before its new read finishes", async () => {
  const h = calendar({ warm: true });
  h.reads[0].gate.resolve(saved);
  await h.settle();
  const firstWrites = h.writes.length;
  h.scope(["user-b", "home-b"]);
  h.value.changeMonth(1);
  h.value.selectCalendarDate("2025-05-14");
  const foreignRead = h.reads.at(-1)!;
  h.scope(["user-a", "home-a"]);
  assert.equal(h.writes.length, firstWrites);
  foreignRead.gate.resolve({ calendar: { month: 6, year: 2030, selectedDate: "2030-07-17" } });
  await h.settle();
  assert.equal(h.writes.length, firstWrites);
  h.reads.at(-1)!.gate.resolve(saved);
  await h.settle();
  assert.deepEqual(snapshot(h.value), saved.calendar);
  assert.equal(h.writes.length, firstWrites + 1);
  assert.deepEqual(h.writes.at(-1), { user: "user-a", household: "home-a", calendar: saved.calendar });
  h.unmount();
});

test("desktop automatic day selection preserves an explicit newer day while warm hydration is pending", async () => {
  const h = calendar({ warm: true, desktop: true });
  assert.equal(h.value.selectedDate, "2026-11-03", "The actual desktop effect initially selects today");
  h.value.changeMonth(1);
  assert.equal(h.value.selectedDate, "2026-12-01", "The desktop effect selects the navigated month's first day");
  h.value.selectCalendarDate("2026-12-24");
  h.reads[0].gate.resolve(saved);
  await h.settle();
  assert.deepEqual(snapshot(h.value), { month: 11, year: 2026, selectedDate: "2026-12-24" });
  assert.deepEqual(h.writes.map(write => write.calendar), [snapshot(h.value)]);
  h.unmount();
});

test("returning to a scope whose earlier load was canceled falls back to its current month when saved navigation is missing or invalid", async () => {
  for (const preferences of [{}, { calendar: { month: 12, year: 2027 } }, { calendar: { month: 5, year: 1999 } }] as Preferences[]) {
    const h = calendar();
    const canceledA = h.reads[0];
    h.scope(["user-b", "home-b"]);
    h.value.openMonthSearch();
    h.value.changeSearchYear(2);
    h.value.chooseMonthFromSearch(6);
    h.value.selectCalendarDate("2028-07-19");
    h.reads.at(-1)!.gate.resolve({});
    await h.settle();
    assert.deepEqual(snapshot(h.value), { month: 6, year: 2028, selectedDate: "2028-07-19" });
    h.scope(["user-a", "home-a"]);
    const writesBeforeA = h.writes.length;
    canceledA.gate.resolve(saved);
    await h.settle();
    assert.equal(h.writes.length, writesBeforeA, "Canceled A cannot publish after the destination changes");
    h.reads.at(-1)!.gate.resolve(preferences);
    await h.settle();
    assert.deepEqual(snapshot(h.value), { month: 10, year: 2026 });
    assert.deepEqual(h.writes.at(-1), { user: "user-a", household: "home-a", calendar: { month: 10, year: 2026 } });
    h.unmount();
  }
});

test("changing only the explicit date request token starts a fresh request and rejects its pending predecessor", async () => {
  const h = calendar({ warm: true, route: { openDate: "2028-02-29", openDateAt: "first" } });
  const stale = h.reads[0];
  h.value.selectCalendarDate("2028-02-20");
  h.route({ openDate: "2028-02-29", openDateAt: "second" });
  assert.equal(h.reads.length, 2);
  assert.deepEqual(snapshot(h.value), { month: 1, year: 2028, selectedDate: "2028-02-29" });
  stale.gate.resolve(saved);
  await h.settle();
  assert.equal(h.writes.length, 0);
  h.reads[1].gate.resolve(saved);
  await h.settle();
  assert.deepEqual(h.writes, [{ user: "user-a", household: "home-a", calendar: { month: 1, year: 2028, selectedDate: "2028-02-29" } }]);
  h.unmount();
});

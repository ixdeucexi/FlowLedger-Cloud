import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import * as appearance from "./appearance";
import { CALENDAR_CATEGORIES, CALENDAR_COLOR_CHOICES } from "./calendarColors";
import {
  calendarAppearance,
  calendarAccentVariables,
  calendarCategory,
  calendarHighlightText,
} from "./calendarAppearance";
const {
  DEFAULT_APPEARANCE,
  APPEARANCE_PRESETS,
  ACCENT_CHOICES,
  APPEARANCE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  parseAppearance,
  normalizeAppearance,
  appearancePreset,
  appearanceBasePreset,
  appearancePalette,
  contrastRatio,
  createAppearanceWriter,
} = appearance;

// Load canonical palettes at runtime so test compilation retains lib's existing
// output root; do not duplicate production color or surface constants.
function loadConstants(
  file: string,
  dependencies: Record<string, unknown> = {},
) {
  const exports: any = {};
  const javascript = transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  new Function("exports", "require", javascript)(exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    throw Error("Unexpected palette dependency " + name);
  });
  return exports;
}
const colors = loadConstants("constants/colors.ts", {
  "./surfaces": loadConstants("constants/surfaces.ts"),
}).default;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function provider(storage?: {
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
}) {
  const slots: any[] = [],
    effects: Array<() => void> = [],
    cleanups: Array<() => void> = [];
  let cursor = 0,
    dirty = false,
    value: any;
  const hooks: any = {
    __esModule: true,
    default: {
      createElement: (type: any, props: any, ...children: any[]) => ({
        type,
        props: { ...props, children },
      }),
    },
    createContext: () => ({ Provider: "ThemeProvider" }),
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (next: any) => {
          const v = typeof next === "function" ? next(slots[i]) : next;
          if (v !== slots[i]) {
            slots[i] = v;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(fn: any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j]))
        slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = cursor++;
      if (!slots[i] || deps.some((d, j) => d !== slots[i][j])) {
        slots[i] = deps;
        effects.push(() => {
          const cleanup = fn();
          if (cleanup) cleanups.push(cleanup);
        });
      }
    },
  };
  const writes: Array<{ key: string; value: string }> = [],
    data = new Map<string, string>();
  const store = {
    getItem: storage?.getItem ?? (async (key: string) => data.get(key) ?? null),
    setItem: async (key: string, v: string) => {
      writes.push({ key, value: v });
      if (storage?.setItem) await storage.setItem(key, v);
      data.set(key, v);
    },
  };
  const source = transpileModule(
    readFileSync("context/ThemeContext.tsx", "utf8"),
    {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        jsx: JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const exports: any = {};
  new Function("exports", "require", source)(exports, (name: string) => {
    if (name === "react") return hooks;
    if (name === "@react-native-async-storage/async-storage")
      return { __esModule: true, default: store };
    if (name === "@/lib/appearance") return appearance;
    throw Error("Unexpected provider dependency " + name);
  });
  const render = () => {
    cursor = 0;
    dirty = false;
    value = exports.ThemeProvider({ children: null }).props.value;
    while (effects.length) effects.shift()!();
    return value;
  };
  const settle = async () => {
    await tick();
    if (dirty) render();
    await tick();
    if (dirty) render();
    return value;
  };
  render();
  return {
    get value() {
      if (dirty) render();
      return value;
    },
    settle,
    render,
    writes,
    data,
    unmount() {
      for (const f of cleanups) f();
    },
  };
}

test("appearance parser bounds storage, migrates legacy mode, and rejects injected fields", () => {
  for (const raw of [
    null,
    "{",
    "[]",
    '"dark"',
    "x".repeat(2049),
    JSON.stringify({ version: 99, themeMode: "light" }),
  ])
    assert.deepEqual(parseAppearance(raw, "auto"), {
      ...DEFAULT_APPEARANCE,
      themeMode: "auto",
    });
  const v = normalizeAppearance({
    version: 1,
    themeMode: "javascript:bad",
    accent: "#fff",
    backdrop: "external-image",
    contrast: "super",
    success: "#123456",
    font: "unknown",
  });
  assert.deepEqual(v, DEFAULT_APPEARANCE);
  assert.equal(Object.keys(v).length, 5);
  assert.equal(
    parseAppearance(
      JSON.stringify({ ...DEFAULT_APPEARANCE, themeMode: "light" }),
      "dark",
    ).themeMode,
    "light",
  );
});
test("presets are complete atomic bundles; customization and reset report accurate names", () => {
  assert.equal(APPEARANCE_PRESETS.length, 5);
  for (const p of APPEARANCE_PRESETS) {
    assert.deepEqual(normalizeAppearance(p.preferences), p.preferences);
    assert.equal(appearancePreset({ ...p.preferences })?.id, p.id);
    assert.equal(
      appearancePreset({ ...p.preferences, contrast: "high" }),
      null,
    );
  }
  assert.equal(appearancePreset({ ...DEFAULT_APPEARANCE })?.name, "FlowLedger");
});
test("each app preset remains selected with independent calendar colors", () => {
  for (const preset of APPEARANCE_PRESETS) {
    const value = Object.freeze({
      ...preset.preferences,
      calendarColors: Object.freeze({
        income: "blue" as const,
        risk: "teal" as const,
      }),
    });
    const before = JSON.stringify(value);
    assert.equal(appearanceBasePreset(value)?.id, preset.id);
    assert.equal(
      appearancePreset(value),
      null,
      "whole appearance remains customized",
    );
    assert.equal(
      JSON.stringify(value),
      before,
      "selection does not mutate preferences",
    );
    assert.equal(appearanceBasePreset(preset.preferences)?.id, preset.id);
  }
});
test("individual app settings remain honestly Custom when no base preset matches", () => {
  for (const change of [
    { themeMode: "auto" as const },
    { accent: "amber" as const },
    { backdrop: "subtle" as const },
    { contrast: "high" as const },
  ]) {
    const value = {
      ...DEFAULT_APPEARANCE,
      ...change,
      calendarColors: { income: "blue" as const },
    };
    assert.equal(appearanceBasePreset(value), null);
    assert.equal(appearancePreset(value), null);
  }
});
test("custom accents keep white button text readable in both modes and preserve financial colors", () => {
  for (const mode of ["dark", "light"] as const)
    for (const accent of ACCENT_CHOICES) {
      const p = { ...DEFAULT_APPEARANCE, accent: accent.id };
      const c = appearancePalette(mode, p, colors[mode]);
      assert.equal(
        c.primary,
        accent.id === "default"
          ? colors[mode].primary
          : mode === "dark"
            ? accent.darkColor
            : accent.color,
      );
      for (const semantic of ["success", "destructive", "warning"] as const)
        assert.equal(c[semantic], colors[mode][semantic]);
      if (accent.id !== "default") {
        assert.ok(
          contrastRatio(c.primary, "#ffffff") >= 4.5,
          `${mode}/${accent.id}`,
        );
        assert.ok(contrastRatio(c.primary, c.primaryForeground) >= 4.5);
      }
      const high = appearancePalette(
        mode,
        { ...p, contrast: "high" },
        colors[mode],
      );
      assert.ok(contrastRatio(high.foreground, high.card) > 12);
      assert.equal(high.primary, c.primary);
    }
  for (const mode of ["dark", "light"] as const)
    assert.deepEqual(
      appearancePalette(mode, DEFAULT_APPEARANCE, colors[mode]),
      colors[mode],
    );
});
test("writer serializes snapshots and continues after rejection", async () => {
  const gate = deferred<void>(),
    started: string[] = [];
  let first = true;
  const write = createAppearanceWriter(async (p) => {
    started.push(p.accent);
    if (first) {
      first = false;
      await gate.promise;
    }
  });
  const mutable = { ...DEFAULT_APPEARANCE, accent: "blue" as const };
  const a = write(mutable);
  mutable.accent = "rose" as "blue";
  const b = write({ ...DEFAULT_APPEARANCE, accent: "teal" });
  await tick();
  assert.deepEqual(started, ["blue"]);
  const rejection = assert.rejects(a, /offline/);
  gate.reject(Error("offline"));
  await rejection;
  await b;
  assert.deepEqual(started, ["blue", "teal"]);
});
test("provider preserves explicit user changes over late hydration and persists only complete bundles", async () => {
  const read = deferred<string | null>();
  const h = provider({
    getItem: (key) =>
      key === APPEARANCE_STORAGE_KEY ? read.promise : Promise.resolve("light"),
  });
  h.value.applyPreset("ocean");
  read.resolve(
    JSON.stringify(
      APPEARANCE_PRESETS.find((p) => p.id === "mint")!.preferences,
    ),
  );
  await h.settle();
  assert.equal(h.value.presetName, "Ocean");
  assert.equal(h.value.ready, true);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(
    JSON.parse(h.writes[0].value),
    APPEARANCE_PRESETS.find((p) => p.id === "ocean")!.preferences,
  );
  h.value.updateAppearance({ contrast: "high" });
  await h.settle();
  assert.equal(h.value.presetName, "Custom");
  h.value.resetAppearance();
  await h.settle();
  assert.deepEqual(h.value.appearance, DEFAULT_APPEARANCE);
  assert.ok(h.writes.every((w) => w.key === APPEARANCE_STORAGE_KEY));
});
test("read failure settles startup; load retry never writes defaults or overwrites a newer choice", async () => {
  let fail = true;
  const later = deferred<string | null>();
  const h = provider({
    getItem: async (key) => {
      if (key === LEGACY_THEME_STORAGE_KEY) return "dark";
      if (fail) throw Error("unavailable");
      return later.promise;
    },
  });
  await h.settle();
  assert.equal(h.value.ready, true);
  assert.equal(h.value.loadError, true);
  assert.equal(h.value.saveError, false);
  assert.equal(h.writes.length, 0);
  fail = false;
  h.value.retryLoad();
  h.value.applyPreset("sunset");
  later.resolve(
    JSON.stringify(
      APPEARANCE_PRESETS.find((p) => p.id === "paper")!.preferences,
    ),
  );
  await h.settle();
  assert.equal(h.value.presetName, "Sunset");
  assert.equal(h.value.loadError, false);
  assert.equal(h.writes.length, 1);
});
test("load retry restores the saved look without performing a write", async () => {
  let fail = true;
  const h = provider({
    getItem: async (key) => {
      if (key === LEGACY_THEME_STORAGE_KEY) return "dark";
      if (fail) throw Error("unavailable");
      return JSON.stringify(
        APPEARANCE_PRESETS.find((p) => p.id === "paper")!.preferences,
      );
    },
  });
  await h.settle();
  fail = false;
  h.value.retryLoad();
  await h.settle();
  assert.equal(h.value.presetName, "Paper");
  assert.equal(h.value.loadError, false);
  assert.equal(h.writes.length, 0);
});
test("write failure leaves the applied look with a recoverable error; retry stores the latest selection", async () => {
  let fail = true;
  const h = provider({
    setItem: async () => {
      if (fail) throw Error("disk");
    },
  });
  await h.settle();
  h.value.applyPreset("mint");
  await h.settle();
  assert.equal(h.value.saveError, true);
  assert.equal(h.value.presetName, "Mint");
  assert.equal(h.value.saving, false);
  fail = false;
  h.value.retrySave();
  await h.settle();
  assert.equal(h.value.saveError, false);
  assert.equal(h.value.saving, false);
  assert.equal(JSON.parse(h.data.get(APPEARANCE_STORAGE_KEY)!).accent, "teal");
});
test("both settings paths share controls; background and desktop tokens consume the same preference", () => {
  for (const path of [
    "app/(tabs)/more.tsx",
    "components/desktop/DesktopSettingsPage.tsx",
  ])
    assert.match(readFileSync(path, "utf8"), /<AppearanceSettings \/>/);
  const ui = readFileSync("components/AppearanceSettings.tsx", "utf8");
  assert.match(ui, /aria-pressed/);
  assert.match(ui, /Reset appearance/);
  assert.match(ui, /Retry loading appearance/);
  assert.match(ui, /example amounts/);
  assert.match(
    readFileSync("components/desktop/DesktopChrome.tsx", "utf8"),
    /desktopThemeVariables\(colors.isDark, appearance\)/,
  );
  assert.match(
    readFileSync("components/desktop/DesktopUI.tsx", "utf8"),
    /appearancePalette\(isDark \? "dark" : "light", appearance, colors\[isDark \? "dark" : "light"\]\)/,
  );
  assert.match(
    readFileSync("components/FlowWaveBackground.tsx", "utf8"),
    /appearance.backdrop === "plain"/,
  );
  assert.match(
    readFileSync("components/PremiumBackdrop.tsx", "utf8"),
    /<FlowWaveBackground/,
  );
});

test("calendar preferences validate closed keys and migrate old five-field records", () => {
  assert.equal(
    Object.keys(parseAppearance(JSON.stringify(DEFAULT_APPEARANCE))).length,
    5,
  );
  const value = normalizeAppearance({
    ...DEFAULT_APPEARANCE,
    calendarColors: {
      income: "blue",
      bill: "rose",
      risk: "#fff",
      unknown: "green",
    },
  });
  assert.deepEqual(value.calendarColors, { income: "blue", bill: "rose" });
  assert.equal(appearancePreset(value), null);
  for (const invalid of [null, [], "green", { risk: "url(javascript:bad)" }])
    assert.equal(
      normalizeAppearance({ ...DEFAULT_APPEARANCE, calendarColors: invalid })
        .calendarColors,
      undefined,
    );
});

test("all calendar colors stay legible across themes and share category mappings", () => {
  assert.equal(calendarCategory("goal"), "plan");
  assert.equal(calendarCategory("expense"), "spending");
  for (const mode of ["light", "dark"] as const) {
    const planTones = new Set<string>(),
      spendingTones = new Set<string>();
    for (const accent of ACCENT_CHOICES) {
      const preferences = { ...DEFAULT_APPEARANCE, accent: accent.id };
      const base = appearancePalette(mode, preferences, colors[mode]);
      const tones = calendarAppearance(mode, preferences, base);
      assert.equal(
        new Set(Object.values(tones).map((tone) => tone.color)).size,
        CALENDAR_CATEGORIES.length,
        `${mode}/${accent.id} automatic colors are distinct`,
      );
      planTones.add(tones.plan.color);
      spendingTones.add(tones.spending.color);
      assert.notEqual(tones.plan.color, tones.spending.color);
      assert.ok(
        contrastRatio(base.primary, calendarHighlightText(base.primary)) >= 4.5,
      );
      for (const { id } of CALENDAR_CATEGORIES) {
        for (const choice of CALENDAR_COLOR_CHOICES) {
          const custom = calendarAppearance(
            mode,
            { ...preferences, calendarColors: { [id]: choice.id } },
            base,
          );
          assert.equal(custom[id].color, choice[mode]);
          assert.ok(
            contrastRatio(custom[id].text, custom[id].bg) >= 4.5,
            `${mode}/${accent.id}/${id}/${choice.id}`,
          );
          for (const other of CALENDAR_CATEGORIES.filter(
            (category) => category.id !== id,
          ))
            assert.deepEqual(custom[other.id], tones[other.id]);
        }
      }
    }
    assert.equal(planTones.size, ACCENT_CHOICES.length);
    assert.equal(spendingTones.size, ACCENT_CHOICES.length);
  }
});

test("calendar overrides survive app presets and mode changes; reset clears only what was requested", async () => {
  const h = provider();
  await h.settle();
  h.value.updateAppearance({
    calendarColors: { income: "blue", risk: "teal" },
  });
  h.value.applyPreset("mint");
  await h.settle();
  assert.equal(h.value.appearance.themeMode, "light");
  assert.deepEqual(h.value.appearance.calendarColors, {
    income: "blue",
    risk: "teal",
  });
  assert.equal(h.value.presetName, "Custom");
  h.value.setThemeMode("dark");
  await h.settle();
  assert.deepEqual(h.value.appearance.calendarColors, {
    income: "blue",
    risk: "teal",
  });
  const staleUpdate = h.value.updateAppearance;
  staleUpdate((current: any) => ({
    calendarColors: { ...current.calendarColors, debt: "amber" },
  }));
  staleUpdate((current: any) => ({
    calendarColors: { ...current.calendarColors, plan: "rose" },
  }));
  await h.settle();
  assert.deepEqual(h.value.appearance.calendarColors, {
    income: "blue",
    risk: "teal",
    debt: "amber",
    plan: "rose",
  });
  h.value.updateAppearance({ calendarColors: undefined });
  await h.settle();
  assert.equal(h.value.appearance.calendarColors, undefined);
  assert.equal(h.value.appearance.accent, "teal");
  h.value.updateAppearance({ calendarColors: { spending: "cyan" } });
  h.value.resetAppearance();
  await h.settle();
  assert.deepEqual(h.value.appearance, DEFAULT_APPEARANCE);
  assert.deepEqual(
    JSON.parse(h.data.get(APPEARANCE_STORAGE_KEY)!),
    DEFAULT_APPEARANCE,
  );
});

test("queued writes snapshot nested calendar choices", async () => {
  const gate = deferred<void>();
  const saved: any[] = [];
  const write = createAppearanceWriter(async (value) => {
    await gate.promise;
    saved.push(value);
  });
  const value = {
    ...DEFAULT_APPEARANCE,
    calendarColors: { income: "blue" as const },
  };
  const pending = write(value);
  value.calendarColors.income = "rose" as "blue";
  gate.resolve();
  await pending;
  assert.equal(saved[0].calendarColors.income, "blue");
});

test("both calendar views use shared tones and retain text risk signals", () => {
  const mobile = readFileSync("components/CalendarView.tsx", "utf8");
  const desktop = readFileSync(
    "components/desktop/DesktopCalendarPage.tsx",
    "utf8",
  );
  for (const source of [mobile, desktop]) {
    assert.match(source, /useCalendarAppearance/);
    assert.match(source, /Calendar legend/);
    assert.match(source, /calendarHighlightText/);
  }
  assert.match(mobile, /Build cushion/);
  assert.match(mobile, /Overdue ·/);
  const controls = readFileSync(
    "components/CalendarAppearanceSettings.tsx",
    "utf8",
  );
  assert.match(controls, /Custom calendar colors stay when you change presets/);
  assert.match(controls, /Use theme color for/);
  assert.match(controls, /Reset calendar colors/);
  assert.doesNotMatch(controls, /useBudget|reconcileTransaction/);
});

test("desktop Original Light calendar fills match their computed foreground", () => {
  const source = readFileSync(
    "components/desktop/DesktopCalendarPage.tsx",
    "utf8",
  );
  const c = appearancePalette("light", DEFAULT_APPEARANCE, colors.light);
  assert.notEqual(
    c.primary,
    "#6d3bea",
    "legacy desktop purple differs from the original light accent",
  );
  const accentVariables = calendarAccentVariables(c);
  assert.equal(accentVariables["--fl-desktop-purple"], c.primary);
  assert.equal(accentVariables["--fl-desktop-purple-strong"], c.primary);
  assert.match(source, /\.\.\.calendarAccentVariables\(c\)/);
  const flattenStyle = (style: any): any =>
    Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle))
      : style;
  const styles = new Proxy(
    {},
    {
      get: (_target, name) =>
        String(name).includes("Text")
          ? { color: "#ffffff" }
          : { backgroundColor: "#6d3bea" },
    },
  );
  const createElement = (type: any, props: any, ...children: any[]) => ({
    type,
    props: { ...props, children },
  });
  const render = (expression: string, extra: Record<string, unknown> = {}) => {
    const bindings = {
      React: { createElement },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      Feather: "Feather",
      styles,
      c,
      calendarHighlightText,
      actionText: calendarHighlightText(c.primary),
      onAdd() {},
      onAddTransaction() {},
      selectedDate: "2026-10-29",
      displayDate: () => "October 29",
      selected: true,
      isToday: false,
      cell: { inCurrentMonth: true, day: 29 },
      ...extra,
    };
    const javascript = transpileModule(`const result = (${expression});`, {
      compilerOptions: { jsx: JsxEmit.React, module: ModuleKind.CommonJS },
    }).outputText;
    return new Function(
      ...Object.keys(bindings),
      `${javascript}; return result;`,
    )(...Object.values(bindings));
  };
  const snippets: string[] = [];
  for (const marker of [
    'accessibilityLabel="Add transaction"',
    "accessibilityLabel={`Add transaction on",
  ]) {
    const label = source.indexOf(marker),
      start = source.lastIndexOf("<Pressable", label),
      end = source.indexOf("</Pressable>", label) + "</Pressable>".length;
    assert.ok(label >= 0 && start >= 0);
    snippets.push(source.slice(start, end));
  }
  const dayStart = source.indexOf("<View style={[styles.dayNumberWrap"),
    dayEnd = source.indexOf("</View>", dayStart) + "</View>".length;
  assert.ok(dayStart >= 0);
  snippets.push(source.slice(dayStart, dayEnd));
  for (const snippet of snippets) {
    const node = render(snippet);
    const actual = flattenStyle(
      typeof node.props.style === "function"
        ? node.props.style({ pressed: false })
        : node.props.style,
    );
    assert.equal(actual.backgroundColor, c.primary);
    const text = node.props.children.find(
      (child: any) => child?.type === "Text",
    );
    const foreground = flattenStyle(text.props.style).color;
    assert.equal(foreground, calendarHighlightText(actual.backgroundColor));
    assert.ok(contrastRatio(actual.backgroundColor, foreground) >= 4.5);
  }
});

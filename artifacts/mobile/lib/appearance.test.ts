import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import * as appearance from "./appearance";
const {
  DEFAULT_APPEARANCE,
  APPEARANCE_PRESETS,
  ACCENT_CHOICES,
  APPEARANCE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  parseAppearance,
  normalizeAppearance,
  appearancePreset,
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

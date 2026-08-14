import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

test("all app haptics honor the device preference", () => {
  const haptics = readFileSync("lib/haptics.ts", "utf8");
  const settings = readFileSync("app/(tabs)/more.tsx", "utf8");
  const desktopSettings = readFileSync("components/desktop/DesktopSettingsPage.tsx", "utf8");
  const tabs = readFileSync("app/(tabs)/_layout.tsx", "utf8");
  const directExpoImports = sourceFiles(".")
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .filter((file) => readFileSync(file, "utf8").includes('from "expo-haptics"'))
    .map((file) => file.replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(directExpoImports, ["lib/haptics.ts"]);
  assert.match(haptics, /HAPTICS_STORAGE_KEY = "@flowledger_haptics_enabled_v1"/);
  assert.match(haptics, /value !== "false"/);
  assert.match(haptics, /if \(!\(await loadHapticsEnabled\(\)\)\) return/);
  assert.match(settings, /label="Haptic feedback"/);
  assert.match(settings, /enabled=\{hapticsEnabled\}/);
  assert.match(settings, /setHapticsEnabled\(!hapticsEnabled\)/);
  assert.match(desktopSettings, /title="Haptic feedback"/);
  assert.match(desktopSettings, /setHapticsEnabled\(!hapticsEnabled\)/);
  assert.match(tabs, /screenListeners=\{\{/);
  assert.match(tabs, /Haptics\.selectionAsync\(\)/);
});

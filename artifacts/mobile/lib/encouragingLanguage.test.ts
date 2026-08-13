import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOTS = ["app", "components", "context", "lib"];
const DISCOURAGING_BALANCE_COPY = [
  /\blow[- ]balance\b/i,
  /\blowest balance\b/i,
  /\blowest forecast\b/i,
  /\blowest projected balance\b/i,
  /\bnegative balance\b/i,
  /\bbalance goes negative\b/i,
  /\bgoes negative\b/i,
  /\bthe low point\b/i,
];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [target];
  });
}

test("app copy uses encouraging breathing-room language", () => {
  for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
    const source = readFileSync(file, "utf8");
    for (const phrase of DISCOURAGING_BALANCE_COPY) {
      assert.doesNotMatch(source, phrase, `${file} contains discouraging balance copy`);
    }
  }
});

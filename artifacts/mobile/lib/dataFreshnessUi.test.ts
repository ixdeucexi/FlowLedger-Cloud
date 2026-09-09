import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("cached plan freshness comes from the successful query timestamp", () => {
  const context = readFileSync("context/BudgetContext.tsx", "utf8");

  assert.match(context, /getQueryState\(coreQueryKey\)\?\.dataUpdatedAt/);
  assert.match(context, /bankDataResults\.every\(result => !result\.error\)/);
  assert.doesNotMatch(context, /DataFreshnessLabel/);
});

test("freshness component intentionally renders nothing without changing sync metadata", () => {
  const source = readFileSync("components/DataFreshnessLabel.tsx", "utf8");
  const { transpileModule, ModuleKind } =
    require("typescript") as typeof import("typescript");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  const component: { DataFreshnessLabel?: (props: object) => unknown } = {};
  new Function("exports", compiled)(component);
  assert.equal(component.DataFreshnessLabel!({}), null);
  assert.equal(
    component.DataFreshnessLabel!({ compact: true, inset: true }),
    null,
  );
});

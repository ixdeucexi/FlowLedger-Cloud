import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const context = readFileSync(join(root, "context", "BudgetContext.tsx"), "utf8");
const forecast = readFileSync(join(root, "app", "(tabs)", "monthly.tsx"), "utf8");
const migration = readFileSync(
  join(root, "..", "..", "supabase", "migrations", "20261002010651_bill_occurrence_exceptions.sql"),
  "utf8",
);

test("occurrence exceptions persist an exact amount or skip flag on the existing household-protected table", () => {
  assert.match(migration, /alter table public\.bill_date_moves[\s\S]+custom_amount numeric/i);
  assert.match(migration, /is_skipped boolean not null default false/i);
  assert.match(migration, /check \(custom_amount is null or custom_amount >= 0\)/i);
  assert.match(context, /assertCanEditHousehold\("change a bill occurrence"\)/);
  assert.match(context, /household_id: scope\.householdId, budget_id: scope\.budgetId/);
});

test("failed occurrence saves restore the previous calendar and overrides", () => {
  const start = context.indexOf("const saveBillOccurrenceException");
  const end = context.indexOf("const moveBillOccurrence", start);
  const source = context.slice(start, end);
  assert.match(source, /billDateMovesRef\.current = previous/);
  assert.match(source, /overridesRef\.current = previousOverrides/);
  assert.match(source, /markSaveFailed/);
});

test("queued occurrence saves stay bound to the invoking user and household", () => {
  const start = context.indexOf("const saveBillOccurrenceException");
  const end = context.indexOf("const moveBillOccurrence", start);
  const source = context.slice(start, end);
  assert.match(source, /const invokingUserId = user\.id/);
  assert.match(source, /const invokingScope = householdScopeRef\.current \? \{ \.\.\.householdScopeRef\.current \} : null/);
  assert.match(source, /upsertBillDateMoveRow\(nextMove, invokingUserId, invokingScope\)/);
  assert.match(source, /if \(!invocationIsCurrent\(\)\) return/);
  assert.doesNotMatch(source, /upsertBillDateMoveRow\(nextMove, user\.id, householdScopeRef\.current\)/);
});

test("forecast offers one-or-future removal and never hard-deletes history", () => {
  const start = forecast.indexOf("const handleDeleteBillFromDay");
  const end = forecast.indexOf("const handleDeleteIncomeFromDay", start);
  const source = forecast.slice(start, end);
  assert.match(source, /This payment/);
  assert.match(source, /This & future/);
  assert.match(source, /skipBillOccurrence/);
  assert.match(source, /endBillSeriesBeforeOccurrence/);
  assert.doesNotMatch(source, /deleteBill\(/);
  assert.match(context, /updateBill\(\{ \.\.\.bill, end_date: endDate \}, \["end_date"\]/);
  assert.match(forecast, /accessibilityLabel=\{`Remove \$\{bill\.name\} payment options`\}/);
});

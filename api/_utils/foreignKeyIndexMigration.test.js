const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const migration = readFileSync(
  "supabase/migrations/20260827125035_cover_household_member_owner_foreign_keys.sql",
  "utf8",
);

test("every canonical shared-owner foreign key has a household/user covering index", () => {
  const tables = [
    "account_balances",
    "accounts",
    "bill_date_moves",
    "bill_transaction_matches",
    "bills",
    "categories",
    "category_budgets",
    "decisions",
    "extra_payments",
    "goals",
    "incomes",
    "monthly_overrides",
    "plaid_items",
    "subscription_bill_links",
    "transaction_reconciliations",
    "transactions",
  ];

  for (const table of tables) {
    assert.match(
      migration,
      new RegExp(`on public\\.${table} \\(household_id, user_id\\)`, "i"),
    );
  }
});

test("plan simulation creator and updater references are covered", () => {
  assert.match(migration, /on public\.plan_simulations \(created_by\)/i);
  assert.match(migration, /on public\.plan_simulations \(updated_by\)/i);
});

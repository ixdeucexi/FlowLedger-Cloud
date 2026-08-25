import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(
  process.cwd(),
  "../../supabase/migrations/20260825094548_household_scoped_atomic_categories.sql",
), "utf8").toLowerCase();

test("categories have household-owned identity and cascade with their scope", () => {
  assert.match(migration, /raise exception 'category scope preflight failed'/);
  assert.match(migration, /raise exception 'duplicate household category names must be repaired before migration'/);
  assert.match(migration, /add column if not exists id uuid default gen_random_uuid\(\)/);
  assert.match(migration, /add constraint categories_pkey primary key \(id\)/);
  assert.match(migration, /alter column household_id set not null/);
  assert.doesNotMatch(migration, /alter column budget_id set not null/);
  assert.match(
    migration,
    /categories_household_id_fkey[\s\S]+foreign key \(household_id\)[\s\S]+on delete cascade/,
  );
  assert.doesNotMatch(migration, /foreign key \(budget_id\)[\s\S]+on delete cascade/);
  assert.match(migration, /create unique index if not exists categories_household_normalized_name_key/);
  assert.match(migration, /create index if not exists categories_user_id_idx/);
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.categories from public, anon, authenticated/,
  );
});

test("category mutations require the current household, editor role, and matching budget", () => {
  assert.match(migration, /create or replace function private\.assert_active_category_editor/);
  assert.match(migration, /preference\.active_household_id = p_household_id[\s\S]+for share/);
  assert.match(migration, /member\.role in \('owner', 'manager', 'editor'\)[\s\S]+for share/);
  assert.match(
    migration,
    /budget\.id = p_budget_id[\s\S]+budget\.household_id = p_household_id[\s\S]+for share/,
  );
  assert.equal(
    (migration.match(/pg_advisory_xact_lock\(hashtextextended\(p_household_id::text \|\| ':categories', 0\)\)/g) ?? []).length,
    3,
  );
});

test("rename and delete update only the active household references atomically", () => {
  for (const table of ["public.bills bill", "public.transactions transaction_row"]) {
    const escaped = table.replace(".", "\\.");
    const matches = migration.match(new RegExp(
      `update ${escaped}[\\s\\S]+?household_id = p_household_id[\\s\\S]+?lower\\(regexp_replace`,
      "g",
    )) ?? [];
    assert.equal(matches.length, 2, `${table} must be scoped in rename and delete`);
  }
  assert.match(migration, /lock table public\.category_budgets, public\.bills, public\.transactions in share row exclusive mode/);
  assert.match(migration, /create or replace function private\.merge_household_category_budgets/);
  assert.match(migration, /on conflict \(budget_id, category, month, year\) do update[\s\S]+amount = public\.category_budgets\.amount \+ excluded\.amount/);
  assert.match(migration, /private\.is_builtin_household_category_name\(v_old_name\)/);
  assert.match(migration, /not v_source_is_valid and v_target\.id is null[\s\S]+the category no longer exists/);
  assert.match(migration, /v_source\.id is not null and v_target\.id is not null and v_source\.id <> v_target\.id/);
  assert.match(migration, /set category = 'other'/);
  assert.match(migration, /other is the reserved fallback category/);
  assert.doesNotMatch(migration, /promise\.all/);
});

test("only authenticated wrappers can invoke the atomic category implementation", () => {
  for (const name of ["add", "rename", "delete"] as const) {
    const signature = name === "rename"
      ? `${name}_household_category\\(uuid, uuid, text, text\\)`
      : `${name}_household_category\\(uuid, uuid, text\\)`;
    assert.match(migration, new RegExp(`create or replace function private\\.${name}_household_category\\(`));
    assert.match(migration, new RegExp(`create or replace function public\\.${name}_household_category\\(`));
    assert.match(migration, new RegExp(`revoke all on function private\\.${signature} from public, anon`));
    assert.match(migration, new RegExp(`grant execute on function private\\.${signature} to authenticated, service_role`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to authenticated, service_role`));
  }
  assert.match(migration, /security definer/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
});

test("BudgetContext uses only the atomic category RPCs in live mode", () => {
  const context = readFileSync(resolve(process.cwd(), "context/BudgetContext.tsx"), "utf8");
  assert.match(context, /rpc\("add_household_category"/);
  assert.match(context, /rpc\("rename_household_category"/);
  assert.match(context, /rpc\("delete_household_category"/);
  assert.doesNotMatch(context, /from\("categories"\)\.upsert/);
  assert.doesNotMatch(context, /from\("categories"\)\.delete\(\)\.eq\("name"/);
});

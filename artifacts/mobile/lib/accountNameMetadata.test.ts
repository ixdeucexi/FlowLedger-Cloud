import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAccountDisplayName,
  acknowledgeAccountNameRead,
  mergeRoutingMetadata,
  mergeAccountNameRead,
  type AccountNameIntent,
} from "./accountNameMetadata";
import type { Account, ConnectedBankAccount } from "./financialProjectionTypes";
test("name-only normalization accepts reset and rejects blank or long labels", () => {
  assert.equal(
    normalizeAccountDisplayName("  Bills   account  "),
    "Bills account",
  );
  assert.equal(normalizeAccountDisplayName(null), null);
  assert.throws(() => normalizeAccountDisplayName("   "), /Enter/);
  assert.throws(() => normalizeAccountDisplayName("x".repeat(81)), /80/);
  assert.equal(normalizeAccountDisplayName("x".repeat(80))?.length, 80);
});
test("a verified rename overlays stale provider names while keeping newer cash observations intact", () => {
  const rows: ConnectedBankAccount[] = [
    {
      id: "bank",
      name: "Provider name",
      display_name: "Old",
      current_balance: 999,
      available_balance: 900,
      is_active: true,
      updated_at: "2026-11-12T01:00:00Z",
      mask: "1234",
    },
  ];
  const before = structuredClone(rows);
  const intents: AccountNameIntent[] = [
    {
      scope: "owner:home:budget",
      kind: "bank",
      id: "bank",
      name: "Bills",
      version: 2,
    },
  ];
  const result = mergeAccountNameRead(
    rows,
    "bank",
    "owner:home:budget",
    1,
    intents,
  );
  assert.equal(result[0].display_name, "Bills");
  assert.equal(result[0].current_balance, 999);
  assert.equal(result[0].available_balance, 900);
  assert.equal(result[0].updated_at, rows[0].updated_at);
  assert.equal(result[0].name, "Provider name");
  assert.equal(result[0].mask, "1234");
  assert.deepEqual(rows, before);
  assert.equal(
    mergeAccountNameRead(rows, "bank", "owner:home:budget", 2, intents)[0]
      .display_name,
    "Old",
  );
  assert.equal(
    mergeAccountNameRead(rows, "bank", "different:home:budget", 1, intents)[0]
      .display_name,
    "Old",
  );
});
test("reset cannot be resurrected by an older read; manual renames never overwrite balance dates", () => {
  const bank: ConnectedBankAccount = {
    id: "bank",
    name: "Provider",
    display_name: "Old",
    current_balance: 500,
    is_active: true,
  };
  const intents: AccountNameIntent[] = [
    { scope: "s", kind: "bank", id: "bank", name: null, version: 4 },
    { scope: "s", kind: "manual", id: "manual", name: "Emergency", version: 4 },
  ];
  assert.equal(
    mergeAccountNameRead([bank], "bank", "s", 3, intents)[0].display_name,
    undefined,
  );
  const row: Account = {
    id: "manual",
    name: "Old",
    account_type: "savings",
    current_balance: 2000,
    balance_as_of: "2026-11-11",
    created_at: "2026-01-01",
    is_active: true,
  };
  const renamed = mergeAccountNameRead([row], "manual", "s", 3, intents)[0];
  assert.equal(renamed.name, "Emergency");
  assert.equal(renamed.current_balance, 2000);
  assert.equal(renamed.balance_as_of, "2026-11-11");
});
test("newer authoritative names replace old local intent in cache while still guarding older reads", () => {
  const base: ConnectedBankAccount = {
    id: "bank",
    name: "Provider",
    display_name: "B",
    current_balance: 123,
    is_active: true,
  };
  const old: AccountNameIntent[] = [
    { scope: "s", kind: "bank", id: "bank", name: "A", version: 1 },
  ];
  let journal = acknowledgeAccountNameRead([base], "bank", "s", 2, old);
  assert.equal(
    mergeAccountNameRead([base], "bank", "s", 0, journal)[0].display_name,
    "B",
  );
  assert.equal(
    mergeAccountNameRead(
      [{ ...base, display_name: "A" }],
      "bank",
      "s",
      1,
      journal,
    )[0].display_name,
    "B",
  );
  journal = acknowledgeAccountNameRead(
    [{ ...base, display_name: "stale" }],
    "bank",
    "s",
    1,
    journal,
  );
  assert.equal(
    mergeAccountNameRead([base], "bank", "s", 0, journal)[0].display_name,
    "B",
  );
  assert.equal(
    mergeAccountNameRead([base], "bank", "s", 0, journal)[0].current_balance,
    123,
  );
});
test("routing metadata never repaints a newer amount/name or an intervening routing choice", () => {
  const current = {
    id: "bill",
    amount: 200,
    name: "Edited bill",
    funding_account_ref: "manual:newer",
  };
  const merged = mergeRoutingMetadata(
    current,
    { funding_account_ref: null },
    { funding_account_ref: "manual:checking" },
  );
  assert.deepEqual(merged, current);
  const original = { ...current, funding_account_ref: null };
  const assigned = mergeRoutingMetadata(
    original,
    { funding_account_ref: null },
    { funding_account_ref: "manual:checking" },
  );
  assert.equal(assigned.amount, 200);
  assert.equal(assigned.name, "Edited bill");
  assert.equal(assigned.funding_account_ref, "manual:checking");
});

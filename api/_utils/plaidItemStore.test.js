const assert = require("node:assert/strict");
const test = require("node:test");

const { savePlaidItemConnection } = require("./plaidItemStore");

function existingLookup(data, requestedIds) {
  return {
    select() { return this; },
    eq(column, value) {
      requestedIds.push([column, value]);
      return this;
    },
    async maybeSingle() { return { data, error: null }; },
  };
}

test("adding a new Plaid Item inserts it without updating existing connections", async () => {
  const requestedIds = [];
  const inserted = [];
  const updated = [];
  let call = 0;
  const client = {
    from(table) {
      assert.equal(table, "plaid_items");
      call += 1;
      if (call === 1) return existingLookup(null, requestedIds);
      return {
        insert(row) { inserted.push(row); return this; },
        update(row) { updated.push(row); return this; },
        select() { return this; },
        async single() {
          return { data: { id: "new-record", household_id: "house-1", status: "active", institution_name: "Card Bank" }, error: null };
        },
      };
    },
  };

  const result = await savePlaidItemConnection({
    client,
    userId: "user-1",
    householdId: "house-1",
    plaidItemId: "new-item",
    row: { plaid_item_id: "new-item", institution_name: "Card Bank" },
  });

  assert.deepEqual(requestedIds, [["plaid_item_id", "new-item"]]);
  assert.equal(inserted.length, 1);
  assert.equal(updated.length, 0);
  assert.equal(result.refreshedExistingItem, false);
});

test("only reconnecting the exact same Plaid Item updates that Item", async () => {
  const requestedIds = [];
  const inserted = [];
  const updated = [];
  const updateFilters = [];
  let call = 0;
  const client = {
    from(table) {
      assert.equal(table, "plaid_items");
      call += 1;
      if (call === 1) {
        return existingLookup({ id: "existing-record", user_id: "user-1", household_id: "house-1" }, requestedIds);
      }
      return {
        insert(row) { inserted.push(row); return this; },
        update(row) { updated.push(row); return this; },
        eq(column, value) { updateFilters.push([column, value]); return this; },
        select() { return this; },
        async single() {
          return { data: { id: "existing-record", household_id: "house-1", status: "active", institution_name: "Bank" }, error: null };
        },
      };
    },
  };

  const result = await savePlaidItemConnection({
    client,
    userId: "user-1",
    householdId: "house-1",
    plaidItemId: "same-item",
    row: { plaid_item_id: "same-item", institution_name: "Bank" },
  });

  assert.deepEqual(requestedIds, [["plaid_item_id", "same-item"]]);
  assert.equal(inserted.length, 0);
  assert.equal(updated.length, 1);
  assert.deepEqual(updateFilters, [["id", "existing-record"], ["user_id", "user-1"]]);
  assert.equal(result.refreshedExistingItem, true);
});

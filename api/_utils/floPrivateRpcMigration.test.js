const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = [
  "20260821184159_account_deletion_and_flo_rpc_hardening.sql",
  "20260825094550_preserve_shared_plan_after_member_exit.sql",
]
  .map((file) =>
    fs.readFileSync(
      path.join(__dirname, "../../supabase/migrations", file),
      "utf8",
    ),
  )
  .join("\n");

test("authenticated users retain only the access needed by the guarded public Flo wrapper", () => {
  assert.match(
    sql,
    /grant usage on schema private to authenticated, service_role/i,
  );
  assert.match(
    sql,
    /revoke all on function private\.confirm_flo_recurring_bill_proposal\(uuid\) from public, anon/i,
  );
  assert.match(
    sql,
    /grant execute on function private\.confirm_flo_recurring_bill_proposal\(uuid\) to authenticated, service_role/i,
  );
  assert.match(
    sql,
    /function public\.confirm_flo_recurring_bill_proposal[\s\S]*security invoker[\s\S]*select private\.confirm_flo_recurring_bill_proposal/i,
  );
});

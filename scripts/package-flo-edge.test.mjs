import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function packageFunction(name) {
  const output = execFileSync(process.execPath, ["scripts/package-flo-edge.mjs", ...(name ? [name] : [])], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(output);
}

test("Flo edge packaging defaults to v3 and allowlists isolated v4", () => {
  assert.equal(packageFunction().entrypoint_path, "supabase/functions/flo-chat/index.ts");
  const v4 = packageFunction("flo-chat-v4");
  assert.equal(v4.entrypoint_path, "supabase/functions/flo-chat-v4/index.ts");
  assert.ok(v4.files.some(file => file.name === "supabase/functions/flo-chat-v4/core.ts"));
  assert.ok(v4.files.some(file => file.name === "supabase/functions/flo-chat/analysisPlanner.ts"));
});

test("Flo edge packaging rejects arbitrary function paths", () => {
  assert.throws(() => packageFunction("../billing-dispatcher"), /Command failed/);
});

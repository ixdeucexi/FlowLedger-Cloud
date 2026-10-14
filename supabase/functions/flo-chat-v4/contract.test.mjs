import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLO_V4_POLICY_VERSION, FLO_V4_UNSUPPORTED_ANSWER, authorizeFloV4, floV4AuditParameters, runFloV4Pipeline, safeFloV4ErrorCode, validateFloV4Request } from "./core.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const householdId = "22222222-2222-4222-8222-222222222222";

function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      return {
        select(columns) {
          calls.push(["select", table, columns]);
          return this;
        },
        eq(column, value) {
          filters.push([column, value]);
          calls.push(["eq", table, column, value]);
          return this;
        },
        async maybeSingle() {
          calls.push(["maybeSingle", table]);
          return rows[table] ?? { data: null, error: null };
        },
      };
    },
  };
}

test("v4 accepts only the closed history-off request contract", () => {
  assert.deepEqual(
    validateFloV4Request({
      version: 4,
      householdId,
      question: "  What is my balance? ",
      timezone: "America/New_York",
    }).request,
    {
      version: 4,
      householdId,
      question: "What is my balance?",
      timezone: "America/New_York",
    },
  );
  assert.equal(
    validateFloV4Request({
      version: 3,
      householdId,
      question: "x",
      timezone: "UTC",
    }).error,
    "flo_v4_required",
  );
  assert.equal(
    validateFloV4Request({
      version: 4,
      householdId,
      question: "x",
      timezone: "UTC",
      historyEnabled: false,
    }).error,
    "invalid_request",
  );
  assert.equal(
    validateFloV4Request({
      version: 4,
      householdId,
      question: "x",
      timezone: "invalid-zone",
    }).error,
    "invalid_request",
  );
});

test("authorization is exact, sequential, admin-only, active-household, and owner-only", async () => {
  const client = fakeClient({
    feedback_admins: { data: { user_id: userId }, error: null },
    user_preferences: {
      data: { active_household_id: householdId },
      error: null,
    },
    household_members: {
      data: { user_id: userId, household_id: householdId, role: "owner" },
      error: null,
    },
  });
  assert.deepEqual(await authorizeFloV4(client, userId, householdId), {
    authorized: true,
    role: "owner",
  });
  assert.deepEqual(
    client.calls.filter((call) => call[0] === "maybeSingle").map((call) => call[1]),
    ["feedback_admins", "user_preferences", "household_members"],
  );
  assert.deepEqual(
    client.calls.filter((call) => call[0] === "eq"),
    [
      ["eq", "feedback_admins", "user_id", userId],
      ["eq", "user_preferences", "user_id", userId],
      ["eq", "household_members", "household_id", householdId],
      ["eq", "household_members", "user_id", userId],
    ],
  );

  const notAdmin = fakeClient({ feedback_admins: { data: null, error: null } });
  assert.equal((await authorizeFloV4(notAdmin, userId, householdId)).error, "preview_access_denied");
  assert.deepEqual(
    notAdmin.calls.filter((call) => call[0] === "maybeSingle").map((call) => call[1]),
    ["feedback_admins"],
  );

  const inactive = fakeClient({
    feedback_admins: { data: { user_id: userId }, error: null },
    user_preferences: {
      data: { active_household_id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    },
  });
  assert.equal((await authorizeFloV4(inactive, userId, householdId)).error, "active_household_access_denied");

  const member = fakeClient({
    feedback_admins: { data: { user_id: userId }, error: null },
    user_preferences: {
      data: { active_household_id: householdId },
      error: null,
    },
    household_members: {
      data: { user_id: userId, household_id: householdId, role: "member" },
      error: null,
    },
  });
  assert.equal((await authorizeFloV4(member, userId, householdId)).error, "owner_access_required");
});

test("v4 has one analysis pipeline and a bounded null-result response", async () => {
  let calls = 0;
  const options = {
    runtime: { client: { scope: "user" } },
    question: "unsupported",
  };
  const result = await runFloV4Pipeline(
    async (received) => {
      calls += 1;
      assert.equal(received, options);
      return null;
    },
    options,
    "2026-10-13T00:00:00.000Z",
  );
  assert.equal(calls, 1);
  assert.equal(result.answer.answer, FLO_V4_UNSUPPORTED_ANSWER);
  assert.ok(result.answer.answer.length < 300);
  assert.deepEqual(result.sources, []);
});

test("audit metadata and public errors exclude prompt and financial payloads", () => {
  const parameters = floV4AuditParameters({
    outcome: "completed",
    toolNames: ["analyzeFinances"],
    partial: false,
  });
  assert.equal(FLO_V4_POLICY_VERSION, "flo-v4-preview.0");
  assert.deepEqual(Object.keys(parameters).sort(), ["engine", "mode", "outcome", "partial", "toolNames"]);
  assert.doesNotMatch(JSON.stringify(parameters), /question|prompt|balance|records|payload/i);
  assert.doesNotMatch(
    JSON.stringify(
      floV4AuditParameters({
        outcome: "completed",
        question: "Weather in Chicago, IL",
        coordinates: [41.88, -87.63],
      }),
    ),
    /Chicago|41\.88|-87\.63|question|coordinates/,
  );
  assert.equal(safeFloV4ErrorCode(new Error("postgres leaked secret detail")), "answer_failed");
  assert.equal(safeFloV4ErrorCode(new DOMException("timed out", "TimeoutError")), "answer_timeout");
});

test("edge source cannot fall back to agents, proposals, history, or service-scoped analysis", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../flo-chat/analysisPlanner.ts", import.meta.url), "utf8");
  assert.match(source, /runFloV4Pipeline\(\s*runFinancialAnalysis/);
  assert.match(source, /client: auth\.client/);
  assert.match(source, /historyEnabled: false/);
  assert.match(source, /allowSavedPlans: false/);
  assert.doesNotMatch(source, /ToolLoopAgent|createFloTools|draftRecurringBill|flo_proposals|flo_conversations|flo_messages/);
  assert.doesNotMatch(source, /client: server/);
  assert.doesNotMatch(planner, /\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});

test("handler authenticates before consuming or validating an unauthenticated body", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const declaredSize = source.indexOf("declaredLength > FLO_V4_MAX_BODY_BYTES");
  const authenticate = source.indexOf("await authenticateUser(request)");
  const consumeBody = source.indexOf("await request.text()");
  const validateBody = source.indexOf("validateFloV4Request(body)");
  const authorizeOwner = source.indexOf("await authorizeFloV4(");
  assert.ok(declaredSize >= 0 && declaredSize < authenticate);
  assert.ok(authenticate < consumeBody && consumeBody < validateBody && validateBody < authorizeOwner);
  assert.match(source, /authorization\.error === "authorization_unavailable" \? 503 : 403/);
  assert.doesNotMatch(source, /FLO_V4_PREVIEW_(?:ENABLED|ENVIRONMENT)/);
  const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.flo-chat-v4\][\s\S]*?verify_jwt = true/);
});

test("simple intents remain behind auth abuse controls and bypass only model credentials and quota", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const authorizeOwner = source.indexOf("await authorizeFloV4(");
  const rateLimit = source.indexOf("await enforceRateLimit(");
  const safetyFilter = source.indexOf("forbiddenRequest.test(");
  const classify = source.indexOf("classifyFloV4SimpleIntent(");
  const requestAudit = source.indexOf("await audit(server,", classify);
  const runSimple = source.indexOf("await runFloV4SimpleIntent(");
  assert.ok(authorizeOwner < rateLimit && rateLimit < safetyFilter && safetyFilter < classify && classify < requestAudit && requestAudit < runSimple);

  const simpleBranch = source.slice(source.indexOf("if (simpleIntent) {", requestAudit), source.indexOf("} else {", runSimple));
  assert.match(simpleBranch, /client: auth\.client/);
  assert.match(simpleBranch, /weatherProviderConfig/);
  assert.doesNotMatch(simpleBranch, /OPENAI_API_KEY|reserveDailyLimit|runFinancialAnalysis|validated\.request\.timezone/);

  const modelGate = source.slice(source.indexOf("if (!simpleIntent) {", classify), source.indexOf("const requestId", classify));
  assert.match(modelGate, /OPENAI_API_KEY/);
  assert.match(modelGate, /reserveDailyLimit/);
  assert.match(source, /let responseModel: string \| null = null/);
  assert.match(source, /model: responseModel/);
});

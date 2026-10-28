import { runFloCreation, creationIntent, parseCreationDraft } from "../flo-chat/floCreation.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.108.0";
import { runFinancialAnalysis } from "../flo-chat/analysisPlanner.ts";
import type { FloToolRuntime } from "../flo-chat/tools.ts";
import { FLO_V4_MAX_BODY_BYTES, FLO_V4_POLICY_VERSION, authorizeFloV4, floV4AuditParameters, runFloV4Pipeline, safeFloV4ErrorCode, validateFloV4Request } from "./core.ts";
import { classifyFloV4SimpleIntent, runFloV4SimpleIntent, weatherProviderConfig } from "./simpleIntents.ts";

type Client = any;
const encoder = new TextEncoder();
const modelId = Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
const allowedOrigins = new Set(
  (Deno.env.get("FLO_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...cors, "Content-Type": "application/json" };
const forbiddenRequest = /\b(api[_ -]?key|secret|service[_ -]?role|env(?:ironment)?(?: variable)?|source code|repo(?:sitory)?|database password|jwt|token|other users?|(?:other|another) household|all users|rls|bypass|ignore (?:previous|system)|system prompt|developer message|supabase key|plaid credential|access token)\b/i;

function requestCors(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return cors;
  if (!allowedOrigins.has(origin)) return null;
  return { ...cors, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function withCors(response: Response, headers: Record<string, string>) {
  const next = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) next.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: jsonHeaders,
  });
}

function sse(type: string, payload: Record<string, unknown>) {
  return encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

async function stableSafetyIdentifier(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(userId));
  return `flo_${Array.from(new Uint8Array(signature))
    .slice(0, 18)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function authenticateUser(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return { error: jsonError("session_required", 401) };
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !publishableKey) return { error: jsonError("server_configuration", 503) };
  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return { error: jsonError("session_required", 401) };
  return { client, userId: user.id, url };
}

function serverClient(url: string): Client | null {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}

async function enforceRateLimit(server: Client, userId: string, householdId: string) {
  const rate = await server.rpc("consume_flo_rate_limit", {
    p_user_id: userId,
    p_household_id: householdId,
    p_max_requests: 12,
    p_window_seconds: 60,
  });
  return rate.error || rate.data !== true ? "rate_limited" : null;
}

async function reserveDailyLimit(server: Client, userId: string, householdId: string, now: string) {
  const configured = Number(Deno.env.get("FLO_DAILY_REQUEST_LIMIT") ?? 100);
  const limit = Number.isInteger(configured) ? Math.max(1, Math.min(configured, 1000)) : 100;
  const daily = await server.rpc("reserve_flo_daily_request", {
    p_user_id: userId,
    p_household_id: householdId,
    p_request_day: now.slice(0, 10),
    p_max_requests: limit,
  });
  if (daily.error) throw new Error("usage_limit_unavailable");
  return daily.data === true ? null : "daily_limit_reached";
}

async function audit(server: Client, row: Record<string, unknown>) {
  const { error } = await server.from("flo_audit_events").insert({ policy_version: FLO_V4_POLICY_VERSION, ...row });
  if (error) throw new Error("audit_unavailable");
}

async function recordUsage(server: Client, row: Record<string, unknown>) {
  const { error } = await server.from("flo_usage").insert(row);
  if (error) throw new Error("usage_persistence_failed");
}

async function handle(request: Request): Promise<Response> {
  const approvedCors = requestCors(request);
  if (!approvedCors) return jsonError("origin_not_allowed", 403);
  if (request.method === "OPTIONS") return withCors(new Response("ok"), approvedCors);
  if (request.method !== "POST") return withCors(jsonError("method_not_allowed", 405), approvedCors);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > FLO_V4_MAX_BODY_BYTES) return withCors(jsonError("request_too_large", 413), approvedCors);

  const auth = await authenticateUser(request);
  if (auth.error) return withCors(auth.error, approvedCors);
  if (!auth.client || !auth.userId || !auth.url) return withCors(jsonError("server_configuration", 503), approvedCors);

  let body: unknown;
  try {
    const raw = await request.text();
    if (encoder.encode(raw).length > FLO_V4_MAX_BODY_BYTES) return withCors(jsonError("request_too_large", 413), approvedCors);
    body = JSON.parse(raw);
  } catch {
    return withCors(jsonError("invalid_json", 400), approvedCors);
  }
  const validated = validateFloV4Request(body);
  if (!validated.request) return withCors(jsonError(validated.error ?? "invalid_request", validated.error === "flo_v4_required" ? 426 : 400), approvedCors);

  const authorization = await authorizeFloV4(auth.client, auth.userId, validated.request.householdId);
  if (!authorization.authorized) return withCors(jsonError(authorization.error, authorization.error === "authorization_unavailable" ? 503 : 403), approvedCors);

  const server = serverClient(auth.url);
  if (!server) return withCors(jsonError("server_configuration", 503), approvedCors);
  let rateFailure: string | null;
  try {
    rateFailure = await enforceRateLimit(server, auth.userId, validated.request.householdId);
  } catch {
    return withCors(jsonError("usage_limit_unavailable", 503), approvedCors);
  }
  if (rateFailure) return withCors(jsonError(rateFailure, 429), approvedCors);
  if (forbiddenRequest.test(validated.request.question)) return withCors(jsonError("safety_request_rejected", 400), approvedCors);

  const now = new Date().toISOString();
  const requestedCreation = creationIntent(validated.request.question, parseCreationDraft(validated.request.creationDraft, validated.request.householdId, now));
  const simpleIntent = classifyFloV4SimpleIntent(validated.request.question);
  let safetySecret: string | null = null;
  let apiKey: string | null = null;
  if (!simpleIntent || requestedCreation?.mode === "create") {
    safetySecret = Deno.env.get("FLO_SAFETY_IDENTIFIER_SECRET") ?? null;
    apiKey = Deno.env.get("OPENAI_API_KEY") ?? null;
    if ((!safetySecret || !apiKey) && !requestedCreation) return withCors(jsonError("server_configuration", 503), approvedCors);
    let dailyFailure: string | null;
    try {
      dailyFailure = await reserveDailyLimit(server, auth.userId, validated.request.householdId, now);
    } catch {
      return withCors(jsonError("usage_limit_unavailable", 503), approvedCors);
    }
    if (dailyFailure) return withCors(jsonError(dailyFailure, 429), approvedCors);
  }

  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  try {
    await audit(server, {
      request_id: requestId,
      user_id: auth.userId,
      household_id: validated.request.householdId,
      event_type: "request",
      parameters: floV4AuditParameters({ outcome: "accepted" }),
      status: "started",
    });
    let runtime: FloToolRuntime | null = null;
    let responseModel: string | null = null;
    let operation: string;
    let rowCount = 0;
    let toolNames: string[] = [];
    let result: any;
    const creationResponse = await runFloCreation({ client: auth.client, userId: auth.userId,
      householdId: validated.request.householdId, commandId: validated.request.commandId ?? "", message: validated.request.question,
      draft: validated.request.creationDraft, apiKey: apiKey ?? Deno.env.get("OPENAI_API_KEY"), modelId, now, timezone: validated.request.timezone,
    });
    if (creationResponse) {
      result = creationResponse; operation = "creation_capability";
    } else if (simpleIntent) {
      result = await runFloV4SimpleIntent(simpleIntent, {
        client: auth.client,
        householdId: validated.request.householdId,
        now,
        weatherConfig: simpleIntent.kind === "weather" ? weatherProviderConfig((name) => Deno.env.get(name)) : null,
      });
      operation = result.operation;
      rowCount = result.auditRowCount;
    } else {
      runtime = {
        client: auth.client,
        householdId: validated.request.householdId,
        userId: auth.userId,
        now,
        timezone: validated.request.timezone,
        toolResults: [],
        toolResultNames: [],
        toolNames: [],
        toolCache: new Map(),
        memberRole: authorization.role,
        allowSavedPlans: false,
        onToolResult: async (name, toolResult) =>
          audit(server, {
            request_id: requestId,
            user_id: auth.userId,
            household_id: validated.request!.householdId,
            event_type: "tool",
            tool_name: name.slice(0, 80),
            parameters: floV4AuditParameters({
              outcome: toolResult.status,
              partial: toolResult.status !== "ok",
            }),
            row_count: toolResult.records.length,
            data_as_of: toolResult.dataAsOf,
            status: toolResult.status === "ok" ? "completed" : "partial",
          }),
      };
      result = await Promise.race([
        runFloV4Pipeline(
          runFinancialAnalysis,
          {
            runtime,
            question: validated.request.question,
            apiKey: apiKey!,
            modelId,
            safetyIdentifier: await stableSafetyIdentifier(auth.userId, safetySecret!),
            historyEnabled: false,
            transientContext: validated.request.conversationContext,
          },
          now,
        ),
        new Promise((_resolve, reject) => setTimeout(() => reject(new DOMException("answer_timeout", "TimeoutError")), 30_000)),
      ]);
      responseModel = modelId;
      operation = "financial_analysis_v4_preview";
      toolNames = [...new Set(runtime.toolNames)];
      rowCount = runtime.toolResults.reduce((sum, item) => sum + item.records.length, 0);
    }
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const answer = result.answer;
    const aggregate = result.aggregate;
    await recordUsage(server, {
      request_id: requestId,
      user_id: auth.userId,
      household_id: validated.request.householdId,
      operation,
      tool_names: toolNames,
      duration_ms: durationMs,
      model: responseModel,
      input_tokens: result.usage?.inputTokens ?? null,
      output_tokens: result.usage?.outputTokens ?? null,
      status: aggregate?.partial ? "partial" : "completed",
      error_code: null,
    });
    await audit(server, {
      request_id: requestId,
      user_id: auth.userId,
      household_id: validated.request.householdId,
      event_type: "answer",
      parameters: floV4AuditParameters({
        outcome: "completed",
        toolNames,
        partial: aggregate?.partial,
      }),
      row_count: rowCount,
      data_as_of: aggregate?.dataAsOf ?? null,
      model: responseModel,
      duration_ms: durationMs,
      input_tokens: result.usage?.inputTokens ?? null,
      output_tokens: result.usage?.outputTokens ?? null,
      status: aggregate?.partial ? "partial" : "completed",
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          sse("meta", {
            version: 4,
            requestId,
            model: responseModel,
            asOf: now,
            dataAsOf: aggregate?.dataAsOf ?? null,
            coverage: aggregate?.coverage ?? {},
            partial: aggregate?.partial === true,
            historyEnabled: false,
            readOnly: !result.creation,
          }),
        );
        controller.enqueue(sse("text-delta", { delta: answer.answer }));
        controller.enqueue(sse("sources", { sources: result.sources ?? [] }));
        controller.enqueue(sse("creation", { creation: result.creation ?? null }));
        controller.enqueue(sse("followups", { items: answer.followups ?? [] }));
        controller.enqueue(
          sse("done", {
            text: answer.answer,
            answer: {
              ...answer,
              dataAsOf: aggregate?.dataAsOf ?? null,
              coverage: aggregate?.coverage ?? {},
              partial: aggregate?.partial === true,
            },
          }),
        );
        controller.close();
      },
    });
    return withCors(
      new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      }),
      approvedCors,
    );
  } catch (error) {
    const code = safeFloV4ErrorCode(error);
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      await audit(server, {
        request_id: requestId,
        user_id: auth.userId,
        household_id: validated.request.householdId,
        event_type: "failure",
        parameters: floV4AuditParameters({ outcome: code }),
        duration_ms: durationMs,
        status: "error",
        error_code: code,
      });
    } catch {
      /* Public response remains redacted even if telemetry is unavailable. */
    }
    console.error("flo-v4 request failed", { requestId, code, durationMs });
    return withCors(jsonError(code, code === "answer_timeout" ? 504 : 503), approvedCors);
  }
}

Deno.serve(handle);

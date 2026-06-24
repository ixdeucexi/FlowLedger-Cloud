import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const instructions = `You are Flo, FlowLedger's warm, direct, nonjudgmental assistant. Never invent or calculate financial values. Use only FINANCIAL FACTS. If facts are insufficient, ask one concise question. You may explain or prepare an action, but cannot save changes. For affordability lead with Yes, Yes but, or Not safely. Stay under 140 words.`;

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    const token = request.headers.get("Authorization");
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
    const authResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: token, apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
    if (!authResponse.ok) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
    const { message, facts, summary = "" } = await request.json();
    if (typeof message !== "string" || message.length > 2000) return Response.json({ error: "invalid_message" }, { status: 400, headers: cors });
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return Response.json({ error: "flo_not_connected" }, { status: 503, headers: cors });
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini", input: `${instructions}\nROLLING SUMMARY:${String(summary).slice(0, 4000)}\nFINANCIAL FACTS:${JSON.stringify(facts).slice(0, 12000)}\nUSER:${message}`, max_output_tokens: 500 }) });
    if (!response.ok) return Response.json({ error: `openai_${response.status}` }, { status: 502, headers: cors });
    const payload = await response.json();
    const reply = payload.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text ?? "I couldn't form a reliable answer.";
    return Response.json({ reply }, { headers: cors });
  }),
};

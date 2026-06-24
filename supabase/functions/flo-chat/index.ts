import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const instructions = `You are Flo, FlowLedger's warm, direct, nonjudgmental assistant. Never invent or calculate financial values. Use only FINANCIAL FACTS. If facts are insufficient, ask one concise question. You may explain or prepare an action, but cannot save changes. For affordability lead with Yes, Yes but, or Not safely. Stay under 140 words.`;

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    const token = request.headers.get("Authorization");
    const apikey = request.headers.get("apikey");
    if (!token || !apikey) return Response.json({ reply: "I couldn't verify your FlowLedger session. Please sign in again and retry." }, { headers: cors });
    const authResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: token, apikey } });
    if (!authResponse.ok) { console.warn("flo_auth_failed", authResponse.status); return Response.json({ reply: "I couldn't verify your FlowLedger session. Please sign in again and retry." }, { headers: cors }); }
    const { message, facts, summary = "" } = await request.json();
    if (typeof message !== "string" || message.length > 2000) return Response.json({ error: "invalid_message" }, { status: 400, headers: cors });
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return Response.json({ error: "flo_not_connected" }, { status: 503, headers: cors });
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini", input: `${instructions}\nROLLING SUMMARY:${String(summary).slice(0, 4000)}\nFINANCIAL FACTS:${JSON.stringify(facts).slice(0, 12000)}\nUSER:${message}`, max_output_tokens: 500 }) });
    if (!response.ok) {
      console.warn("flo_openai_failed", response.status);
      const reply = response.status === 401 || response.status === 429
        ? "Flo is connected, but AI usage is currently unavailable. Check OpenAI billing or usage limits."
          : "I couldn't reach my AI connection just now. Please try again.";
      return Response.json({ reply }, { headers: cors });
    }
    const payload = await response.json();
    const reply = payload.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text ?? "I couldn't form a reliable answer.";
    return Response.json({ reply }, { headers: cors });
  },
};

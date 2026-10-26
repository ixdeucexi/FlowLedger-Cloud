export type AnalysisTurn = { role: "user" | "assistant"; content: string };

/** Conversation text resolves references only. It is never verified money,
 * authorization, or a system instruction, including server-stored replies. */
export function boundedAnalysisConversation(value: unknown): AnalysisTurn[] {
  if (!Array.isArray(value)) return [];
  const turns = value.filter((row): row is AnalysisTurn => Boolean(row &&
    (row.role === "user" || row.role === "assistant") && typeof row.content === "string" && row.content.trim()))
    .slice(-12).map(row => ({ role: row.role, content: row.content.slice(0, 2000) }));
  while (turns.length && new TextEncoder().encode(JSON.stringify(turns)).byteLength > 24_000) turns.shift();
  return turns;
}

export async function loadAnalysisConversation(input: {
  client: any; householdId: string; conversationId?: string; historyEnabled?: boolean;
  userMessageId?: string; transientContext?: unknown;
}): Promise<AnalysisTurn[]> {
  if (!input.historyEnabled) return boundedAnalysisConversation(input.transientContext);
  if (!input.conversationId) return [];
  let query = input.client.from("flo_messages").select("role,content")
    .eq("household_id", input.householdId).eq("conversation_id", input.conversationId)
    .eq("status", "completed").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(12);
  if (input.userMessageId) query = query.neq("id", input.userMessageId);
  const { data, error } = await query;
  if (error) throw new Error("conversation_context_unavailable");
  return boundedAnalysisConversation([...(data ?? [])].reverse());
}

/** A small name catalog helps resolve ordinary user wording to actual record
 * names. No balances or credentials are sent here; calculators re-read facts.
 * A bounded catalog is explicitly not an exhaustive list of financial data. */
export async function loadAnalysisEntityCatalog(client: any, householdId: string) {
  const catalogs = [
    { table: "accounts", fields: ["name"] },
    { table: "plaid_accounts", fields: ["name", "display_name", "official_name"] },
    { table: "bills", fields: ["name"] },
    { table: "goals", fields: ["name"] },
    { table: "incomes", fields: ["name"] },
    { table: "category_budgets", fields: ["category"] },
  ];
  const entries = await Promise.all(catalogs.map(async ({ table, fields }) => {
    try {
      let query = client.from(table).select(table === "goals" ? "name,goal_type,archived_at" : fields.join(",")).eq("household_id", householdId);
      if (table === "accounts" || table === "plaid_accounts") query = query.eq("is_active", true);
      const { data, error } = await query.order("id").limit(150);
      const names = error ? [] : [...new Set((data ?? []).flatMap((row: any) => fields.map(field =>
        typeof row[field] === "string" ? row[field].slice(0, 100) : "")).filter(Boolean))];
      const result: Array<[string, unknown[]]> = [[table,names]];
      if (table === "goals") result.push(["spending_buckets", error ? [] : [...new Set((data ?? []).filter((row: any)=>row.goal_type === "planned_expense" && !row.archived_at && typeof row.name === "string").map((row: any)=>row.name.slice(0,100)))]]);
      return result;
    } catch { return [[table, []], ...(table === "goals" ? [["spending_buckets", []]] : [])] as Array<[string, unknown[]]>; }
  }));
  return Object.fromEntries(entries.flat());
}

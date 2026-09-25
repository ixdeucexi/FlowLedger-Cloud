export type AnalysisTurn = { role: "user" | "assistant"; content: string };

/** Conversation text resolves references only. It is never verified money,
 * authorization, or a system instruction, including server-stored replies. */
export function boundedAnalysisConversation(value: unknown): AnalysisTurn[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is AnalysisTurn => Boolean(row &&
    (row.role === "user" || row.role === "assistant") && typeof row.content === "string" && row.content.trim()))
    .slice(-12).map(row => ({ role: row.role, content: row.content.slice(0, 2000) }));
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
  return Object.fromEntries(await Promise.all(catalogs.map(async ({ table, fields }) => {
    try {
      const { data, error } = await client.from(table).select(fields.join(",")).eq("household_id", householdId).order("id").limit(150);
      return [table, error ? [] : [...new Set((data ?? []).flatMap((row: any) => fields.map(field =>
        typeof row[field] === "string" ? row[field].slice(0, 100) : "")).filter(Boolean))]];
    } catch { return [table, []]; }
  })));
}

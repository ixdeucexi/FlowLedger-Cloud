export type FloSource = { type: string; label: string; asOf?: string };

export type FloStreamEvent =
  | { type: "meta"; conversationId: string; assistantMessageId: string; model?: string; asOf?: string }
  | { type: "status"; message: string }
  | { type: "text-delta"; delta: string }
  | { type: "sources"; sources: FloSource[] }
  | { type: "proposal"; proposal: Record<string, unknown> | null }
  | { type: "done"; messageId: string; text?: string }
  | { type: "error"; code: string; message: string };

export function parseFloSseChunk(
  pending: string,
  chunk: string,
): { pending: string; events: FloStreamEvent[] } {
  const normalized = (pending + chunk).replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: FloStreamEvent[] = [];
  for (const block of blocks) {
    const data = block.split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as FloStreamEvent;
      if (event && typeof event.type === "string") events.push(event);
    } catch {
      // Ignore malformed events and preserve the rest of the stream.
    }
  }
  return { pending: rest, events };
}

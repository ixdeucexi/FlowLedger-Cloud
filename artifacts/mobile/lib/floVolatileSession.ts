import type { FloChatMessage } from "./floPolicy";
import type { FloSource } from "./floStream";

export type FloVolatileSnapshot = {
  messages: FloChatMessage[];
  handledPromptKey?: string | null;
  sources: Record<string, FloSource[]>;
  followups: Record<string, string[]>;
  grounding: Record<string, { dataAsOf?: string | null; partial?: boolean; coverage?: string; caveat?: string }>;
};
export type FloVolatileLease = { scope: string; epoch: number; owner: number };
export const FLO_VOLATILE_MAX_BYTES = 256_000;
export const FLO_VOLATILE_MAX_MESSAGES = 60;

/** Whole messages and warnings are retained or dropped, never truncated.
 * Incomplete replies restore as stopped, with no claims/sources/context rights. */
function retainedSnapshot(input: FloVolatileSnapshot): FloVolatileSnapshot {
  const messages = input.messages.slice(-FLO_VOLATILE_MAX_MESSAGES).map(message => message.role === "flo" && message.contextEligible !== true
    ? { ...message, thinking: false, contextEligible: false, text: "Response stopped before Flo could verify an answer." }
    : { ...message, thinking: false });
  const build = (): FloVolatileSnapshot => {
    const ids = new Set(messages.filter(message => message.role === "flo" && message.contextEligible === true).map(message => message.id));
    return { messages, ...(input.handledPromptKey ? { handledPromptKey: input.handledPromptKey } : {}), sources: Object.fromEntries(Object.entries(input.sources).filter(([id]) => ids.has(id))), followups: Object.fromEntries(Object.entries(input.followups).filter(([id]) => ids.has(id))), grounding: { ...Object.fromEntries(Object.entries(input.grounding).filter(([id]) => ids.has(id))), ...Object.fromEntries(messages.filter(message => message.role === "flo" && !ids.has(message.id)).map(message => [message.id, { partial: true, coverage: "No verified account data" }])) } };
  };
  while (messages.length && new TextEncoder().encode(JSON.stringify(build())).byteLength > FLO_VOLATILE_MAX_BYTES) {
    messages.shift();
    while (messages[0]?.role === "flo") messages.shift();
  }
  return JSON.parse(JSON.stringify(build())) as FloVolatileSnapshot;
}

/** One volatile active-scope slot, not a household-keyed cache. Scope changes,
 * resets and screen ownership invalidate stale cleanup and async writes. */
export function createFloVolatileSession() {
  let scope: string | null = null, epoch = 0, owner = 0;
  let snapshot: FloVolatileSnapshot | null = null;
  const isCurrent = (lease: FloVolatileLease | null | undefined) => Boolean(lease && scope !== null && lease.scope === scope && lease.epoch === epoch && lease.owner === owner);
  return {
    observeScope(next: string | null) {
      if (next !== scope) { scope = next; epoch++; owner++; snapshot = null; }
      return epoch;
    },
    claim(expectedScope: string | null): { lease: FloVolatileLease; snapshot: FloVolatileSnapshot | null } | null {
      if (!scope || expectedScope !== scope) return null;
      owner++;
      return { lease: { scope, epoch, owner }, snapshot: snapshot ? retainedSnapshot(snapshot) : null };
    },
    isCurrent,
    save(lease: FloVolatileLease | null, value: FloVolatileSnapshot) {
      if (!isCurrent(lease)) return false;
      snapshot = retainedSnapshot(value);
      return true;
    },
    release(lease: FloVolatileLease | null) { if (isCurrent(lease)) owner++; },
    reset(lease: FloVolatileLease | null) {
      if (!isCurrent(lease) || !scope) return null;
      owner++; snapshot = null;
      return { scope, epoch, owner };
    },
    clear() { epoch++; owner++; snapshot = null; scope = null; },
  };
}

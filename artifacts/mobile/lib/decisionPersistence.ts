export type PersistableDecisionStatus = "saved" | "planned" | "completed" | "cancelled" | "reversed" | "calendar" | "applied";

export interface PersistableDecision {
  name: string;
  decision_type: string;
  scenario: unknown;
  result: unknown;
  status: PersistableDecisionStatus;
  calendar_date?: string | null;
  applied_change?: Record<string, unknown> | null;
  actual_amount?: number | null;
  remind_at?: string | null;
  next_due_date?: string | null;
  completed_at?: string | null;
}

function dbStatus(status: PersistableDecisionStatus): Exclude<PersistableDecisionStatus, "calendar" | "applied"> {
  if (status === "calendar") return "planned";
  if (status === "applied") return "completed";
  return status;
}

export function decisionDbPayload(decision: PersistableDecision) {
  return {
    name: decision.name,
    decision_type: decision.decision_type,
    scenario: decision.scenario,
    result: decision.result,
    status: dbStatus(decision.status),
    calendar_date: decision.calendar_date ?? null,
    applied_change: decision.applied_change ?? null,
    actual_amount: decision.actual_amount ?? null,
    remind_at: decision.remind_at ?? null,
    next_due_date: decision.next_due_date ?? null,
    completed_at: decision.completed_at ?? null,
  };
}

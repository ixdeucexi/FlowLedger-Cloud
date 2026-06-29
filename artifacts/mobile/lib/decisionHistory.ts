export type DecisionHistoryStatus = "upcoming" | "due" | "completed" | "postponed" | "cancelled" | "saved";

export interface DecisionHistoryInput {
  id: string;
  name: string;
  status: "saved" | "planned" | "completed" | "cancelled" | "reversed" | "calendar" | "applied";
  scenario: { amount: number; date: string; type?: string };
  actual_amount?: number;
  remind_at?: string;
  completed_at?: string;
  next_due_date?: string;
}

export interface DecisionHistoryItem {
  id: string;
  name: string;
  date: string;
  status: DecisionHistoryStatus;
  plannedAmount: number;
  actualAmount?: number;
  amountLabel: string;
  varianceLabel?: string;
}

export interface DecisionHistoryGroups {
  upcoming: DecisionHistoryItem[];
  completed: DecisionHistoryItem[];
  changed: DecisionHistoryItem[];
}

export function buildDecisionHistory(decisions: DecisionHistoryInput[], today: string, nowIso = new Date().toISOString()): DecisionHistoryGroups {
  const items = decisions.map(decisionHistoryItem).sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    return dateCompare || left.name.localeCompare(right.name);
  });
  return {
    upcoming: items.filter(item => item.status === "due" || item.status === "upcoming" || item.status === "saved"),
    completed: items.filter(item => item.status === "completed"),
    changed: items.filter(item => item.status === "postponed" || item.status === "cancelled"),
  };

  function decisionHistoryItem(decision: DecisionHistoryInput): DecisionHistoryItem {
    const plannedAmount = Math.abs(Number(decision.scenario.amount) || 0);
    const actualAmount = decision.actual_amount === undefined ? undefined : Math.abs(Number(decision.actual_amount) || 0);
    const status = historyStatus(decision, today, nowIso);
    const variance = actualAmount === undefined ? null : actualAmount - plannedAmount;
    return {
      id: decision.id,
      name: decision.name,
      date: decision.next_due_date ?? decision.scenario.date,
      status,
      plannedAmount,
      actualAmount,
      amountLabel: actualAmount === undefined
        ? `Planned $${plannedAmount.toFixed(2)}`
        : `Planned $${plannedAmount.toFixed(2)} · Actual $${actualAmount.toFixed(2)}`,
      varianceLabel: variance === null
        ? undefined
        : `${variance >= 0 ? "+" : "-"}$${Math.abs(variance).toFixed(2)} vs plan`,
    };
  }
}

function historyStatus(decision: DecisionHistoryInput, today: string, nowIso: string): DecisionHistoryStatus {
  if (decision.status === "completed" || decision.status === "applied") return "completed";
  if (decision.status === "cancelled" || decision.status === "reversed") return "cancelled";
  if (decision.remind_at && decision.remind_at > nowIso) return "postponed";
  if (decision.status === "saved") return "saved";
  const dueDate = decision.next_due_date ?? decision.scenario.date;
  return dueDate <= today ? "due" : "upcoming";
}

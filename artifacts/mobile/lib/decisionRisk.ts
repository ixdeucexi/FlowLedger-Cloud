import { scenarioDates, type DecisionBaselineDay, type DecisionScenario } from "./decisions";

export interface DecisionRiskInput {
  id: string;
  name: string;
  status: "saved" | "planned" | "completed" | "cancelled" | "reversed" | "calendar" | "applied";
  scenario: DecisionScenario;
  calendar_date?: string;
  next_due_date?: string;
}

export interface DecisionRiskAlert {
  id: string;
  name: string;
  date: string;
  plannedAmount: number;
  lowestBalance: number;
  lowestBalanceDate: string;
  shortfall: number;
}

export function buildDecisionRiskAlerts(
  decisions: DecisionRiskInput[],
  forecastDays: DecisionBaselineDay[],
  safetyFloor: number,
  today: string,
): DecisionRiskAlert[] {
  if (!forecastDays.length) return [];
  const sortedDays = [...forecastDays].sort((left, right) => left.date.localeCompare(right.date));
  const endDate = sortedDays[sortedDays.length - 1]?.date ?? today;

  return decisions
    .filter(decision => decision.status === "planned" || decision.status === "calendar")
    .flatMap(decision => {
      const firstDate = decision.next_due_date ?? decision.calendar_date ?? decision.scenario.date;
      const scenario = { ...decision.scenario, date: firstDate };
      return scenarioDates(scenario, endDate)
        .filter(date => date >= today)
        .map(date => {
          const futureDays = sortedDays.filter(day => day.date >= date);
          const lowest = futureDays.reduce(
            (best, day) => day.balance < best.balance ? day : best,
            futureDays[0] ?? sortedDays[sortedDays.length - 1],
          );
          if (!lowest || lowest.balance >= safetyFloor) return null;
          return {
            id: decision.id,
            name: decision.name,
            date,
            plannedAmount: Math.abs(Number(decision.scenario.amount) || 0),
            lowestBalance: lowest.balance,
            lowestBalanceDate: lowest.date,
            shortfall: safetyFloor - lowest.balance,
          } satisfies DecisionRiskAlert;
        })
        .filter((alert): alert is DecisionRiskAlert => alert !== null);
    })
    .sort((left, right) => left.date.localeCompare(right.date) || right.shortfall - left.shortfall)
    .filter((alert, index, alerts) => alerts.findIndex(item => item.id === alert.id) === index);
}

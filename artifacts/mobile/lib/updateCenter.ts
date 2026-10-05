import type { AppFeedbackRow } from "./feedback";

export const UPDATE_CENTER_SCREEN = "Settings / Update Center";
export function updateRequestHistory(rows: readonly AppFeedbackRow[], userId: string): AppFeedbackRow[] {
  return rows.filter(row => row.user_id === userId && row.screen === UPDATE_CENTER_SCREEN)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

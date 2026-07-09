export const FEEDBACK_TYPES = [
  { id: "bug", label: "Bug", icon: "alert-circle" },
  { id: "idea", label: "Idea", icon: "star" },
  { id: "confusing", label: "Confusing", icon: "help-circle" },
  { id: "design", label: "Design", icon: "layout" },
  { id: "setup", label: "Setup", icon: "compass" },
  { id: "other", label: "Other", icon: "message-square" },
] as const;

export const FEEDBACK_STATUSES = [
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "fixed", label: "Fixed" },
  { id: "wont_fix", label: "Not planned" },
] as const;

export type FeedbackType = typeof FEEDBACK_TYPES[number]["id"];
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number]["id"];

export type AppFeedbackRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  feedback_type: FeedbackType;
  screen: string;
  message: string;
  rating: number | null;
  can_contact: boolean;
  status: FeedbackStatus;
  app_version: string | null;
  platform: string | null;
  created_at: string;
  updated_at: string | null;
};

const feedbackTypeIds = new Set<string>(FEEDBACK_TYPES.map(type => type.id));
const feedbackStatusIds = new Set<string>(FEEDBACK_STATUSES.map(status => status.id));

export function sanitizeFeedbackMessage(message: string) {
  return message.trim().replace(/\s{3,}/g, "  ").slice(0, 4000);
}

export function canSubmitFeedback(message: string) {
  return sanitizeFeedbackMessage(message).length >= 3;
}

export function normalizeFeedbackType(value: string | null | undefined): FeedbackType {
  return value && feedbackTypeIds.has(value) ? value as FeedbackType : "other";
}

export function normalizeFeedbackStatus(value: string | null | undefined): FeedbackStatus {
  return value && feedbackStatusIds.has(value) ? value as FeedbackStatus : "new";
}

export function feedbackStatusLabel(status: FeedbackStatus) {
  return FEEDBACK_STATUSES.find(item => item.id === status)?.label ?? "New";
}

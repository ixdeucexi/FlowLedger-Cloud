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
  { id: "fixed", label: "Updated" },
  { id: "wont_fix", label: "Not planned" },
] as const;

export type FeedbackType = typeof FEEDBACK_TYPES[number]["id"];
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number]["id"];
export type FeedbackAdminFilter = "active" | "archived" | "all" | FeedbackStatus;
export type FeedbackManagementAction = "reviewing" | "updated" | "not_planned" | "archive" | "restore" | "delete";

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
  admin_note: string | null;
  archived_at: string | null;
  resolved_at: string | null;
  updated_by: string | null;
  submitter_notified_at: string | null;
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

export function feedbackStatusMessage(status: FeedbackStatus) {
  if (status === "reviewing") return "The FlowLedger team is reviewing this.";
  if (status === "fixed") return "An update based on this feedback is now live.";
  if (status === "wont_fix") return "This change is not planned right now.";
  return "Your feedback was received.";
}

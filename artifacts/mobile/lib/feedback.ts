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
export type FeedbackUpdateCenterCopyResult = {
  ok: true;
  copiedRequest: { id: string; archived_at: string | null; status: FeedbackStatus };
  alreadyExists: boolean;
};

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
  if (status === "reviewing") return "Under review.";
  if (status === "fixed") return "This update is now live.";
  if (status === "wont_fix") return "Not planned.";
  return "Received.";
}

/** Public update copy; the saved admin note remains available in the admin inbox. */
export function customerFeedbackReply(note: string | null | undefined, status: FeedbackStatus): string | null {
  if (!note?.trim()) return null;
  const releaseStyleNote = /^LIVE\s*:/i.test(note.trim());
  let reply = note.trim().replace(/\s+/g, " ").replace(/^LIVE\s*:\s*/i, "");
  const engineeringTail = /\b(?:release commit\b|(?:full\s+)?release checks\b|rollback\s*:\s*(?:rollback\/|dpl_|[a-f0-9]{7,40}\b)|prior artifact\s+dpl_|deployment\s+dpl_|production bundle matches\b|no real financial records were (?:modified|changed)\b|dpl_[a-z0-9]+\b|[a-f0-9]{40}\b)/i.exec(reply);
  if (engineeringTail) reply = reply.slice(0, engineeringTail.index);
  reply = reply.replace(/\s+/g, " ").replace(/[\s;:,(-]+$/, "").trim();
  if (!reply) return null;

  if (status === "fixed" && (releaseStyleNote || engineeringTail)) {
    reply = reply
      .replace(/^Close bucket is available in the bucket editor(?: and opens the existing Review Center closing choices)?\./i, "You can now close a bucket from its editor.")
      .replace(/\bPlanned\/spent history and posted transactions are preserved\./gi, "Your past activity stays saved.");
    const sentences = reply.match(/\S[\s\S]*?(?:[.!?](?=\s|$)|$)/g) ?? [reply];
    reply = sentences.slice(0, 2).map(sentence => sentence.trim()).join(" ");
  }

  if ((releaseStyleNote || engineeringTail) && reply.length > 320) {
    const end = reply.lastIndexOf(" ", 317);
    reply = `${reply.slice(0, end > 240 ? end : 317).trimEnd()}…`;
  }
  return reply || null;
}

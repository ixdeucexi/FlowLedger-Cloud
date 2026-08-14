export interface HouseholdActivity {
  id: string;
  householdId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  actorVerified?: boolean;
  action: "created" | "updated" | "deleted" | "joined" | "invited" | "changed_role" | "removed" | string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  createdAt: string;
}

function activityDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function actionFamily(action: string): string {
  return action === "created" || action === "updated" ? "changed" : action;
}

function activityIdentity(activity: HouseholdActivity): string {
  return activity.entityId || activity.entityLabel || activity.entityType;
}

function actorIdentity(activity: HouseholdActivity): string {
  return activity.actorUserId || activity.actorEmail || activity.actorName || "unattributed";
}

/**
 * Recent activity is a human summary, not a raw trigger log. Collapse repeat
 * writes to the same item by the same actor on the same visible calendar day.
 * Different actors, days, and membership actions remain separate.
 */
export function summarizeHouseholdActivity(
  activity: readonly HouseholdActivity[],
  limit = 12,
): HouseholdActivity[] {
  const targetLimit = Math.max(0, Math.floor(limit));
  if (targetLimit === 0) return [];

  const newestFirst = [...activity].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
    return safeRight - safeLeft;
  });
  const seen = new Set<string>();
  const summarized: HouseholdActivity[] = [];

  for (const item of newestFirst) {
    const key = [
      activityDay(item.createdAt),
      actorIdentity(item),
      item.entityType,
      activityIdentity(item),
      actionFamily(item.action),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    summarized.push(item);
    if (summarized.length >= targetLimit) break;
  }

  return summarized;
}

function humanizeEntityType(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export function householdActivityHeadline(activity: HouseholdActivity): string {
  const item = activity.entityLabel || humanizeEntityType(activity.entityType);
  const actor = activity.actorName || activity.actorEmail || "A household member";

  if (activity.actorVerified) {
    switch (activity.action) {
      case "created": return `${actor} created ${item}`;
      case "updated": return `${actor} updated ${item}`;
      case "deleted": return `${actor} removed ${item}`;
      case "joined": return `${actor} joined the household`;
      case "invited": return `${actor} created a ${item} invite`;
      case "changed_role": return `${actor} changed access for ${item}`;
      case "removed": return `${actor} removed ${item} from the household`;
      default: return `${actor} ${activity.action.replace(/_/g, " ")} ${item}`.trim();
    }
  }

  // Older rows used the record owner as a fallback actor, which was not proof
  // that person made the change. Keep those rows useful without assigning blame.
  switch (activity.action) {
    case "created": return `${item} was added`;
    case "updated": return `${item} was updated`;
    case "deleted": return `${item} was removed`;
    case "joined": return "A member joined the household";
    case "invited": return "A household invite was created";
    case "changed_role": return `Household access was changed for ${item}`;
    case "removed": return `${item} was removed from the household`;
    default: return `${item} activity was recorded`;
  }
}

export type NotificationPreferenceKey =
  | "pending_transactions"
  | "posted_transactions"
  | "overdue_bills"
  | "account_tips"
  | "feedback_updates"
  | "admin_feedback";

export interface NotificationPreferences {
  pending_transactions: boolean;
  posted_transactions: boolean;
  overdue_bills: boolean;
  account_tips: boolean;
  feedback_updates: boolean;
  admin_feedback: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pending_transactions: true,
  posted_transactions: true,
  overdue_bills: true,
  account_tips: true,
  feedback_updates: true,
  admin_feedback: true,
};

/** Missing legacy fields use defaults; only actual booleans are accepted. */
export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Could not load notification choices.");
  }
  const source = value as Record<string, unknown>;
  const normalized = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const key of Object.keys(normalized) as NotificationPreferenceKey[]) {
    if (key in source && typeof source[key] !== "boolean") {
      throw new Error("Could not load notification choices.");
    }
    if (typeof source[key] === "boolean") normalized[key] = source[key];
  }
  return normalized;
}

export type NotificationPreferencesChanged = {
  userId: string;
  preferences: NotificationPreferences;
};

const listeners = new Set<(change: NotificationPreferencesChanged) => void>();

export function subscribeNotificationPreferencesChanged(listener: (change: NotificationPreferencesChanged) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Publish only preferences confirmed by the authenticated preferences API. */
export function emitNotificationPreferencesChanged(change: NotificationPreferencesChanged): void {
  if (!change.userId) return;
  for (const listener of listeners) listener(change);
}

/** Refreshing credentials can restart reads without abandoning an active save. */
export class NotificationPreferenceRequestGate {
  private readGeneration = 0;
  private saveGeneration = 0;

  beginRead(): () => boolean {
    const generation = ++this.readGeneration;
    return () => generation === this.readGeneration;
  }

  beginSave(): () => boolean {
    const generation = ++this.saveGeneration;
    this.invalidateReads();
    return () => generation === this.saveGeneration;
  }

  invalidateReads(): void {
    this.readGeneration += 1;
  }

  invalidate(): void {
    this.invalidateReads();
    this.saveGeneration += 1;
  }
}

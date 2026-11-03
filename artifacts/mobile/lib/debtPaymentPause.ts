/** A saved planning pause; lender obligations and the debt itself stay open. */
export type DebtPaymentPause = {
  id: string;
  start_date: string;
  /** Payments resume on this date (the pause end is exclusive). */
  resume_date: string;
  redirect_payment: boolean;
};

export const MAX_DEBT_PAYMENT_PAUSES = 120;

export function isDebtPaymentPauseDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Legacy missing values are empty; malformed saved history must never disappear silently. */
export function normalizeDebtPaymentPauses(value: unknown): DebtPaymentPause[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_DEBT_PAYMENT_PAUSES) {
    throw new Error(`Debt payment pauses must contain at most ${MAX_DEBT_PAYMENT_PAUSES} intervals.`);
  }
  const ids = new Set<string>();
  const pauses = value.map((entry): DebtPaymentPause => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)
      || ids.has(entry.id)) {
      throw new Error("Each debt payment pause needs a unique valid ID.");
    }
    if (!isDebtPaymentPauseDate(entry.start_date) || !isDebtPaymentPauseDate(entry.resume_date)
      || entry.start_date >= entry.resume_date) {
      throw new Error("Debt payment pauses need valid start and resume dates, with resume after start.");
    }
    if (typeof entry.redirect_payment !== "boolean") {
      throw new Error("Choose whether each paused payment is redirected.");
    }
    ids.add(entry.id);
    return { id: entry.id, start_date: entry.start_date, resume_date: entry.resume_date, redirect_payment: entry.redirect_payment };
  }).sort((left, right) => left.start_date.localeCompare(right.start_date) || left.id.localeCompare(right.id));
  pauses.forEach((pause, index) => {
    if (index > 0 && pauses[index - 1].resume_date > pause.start_date) {
      throw new Error("Debt payment pauses cannot overlap.");
    }
  });
  return pauses;
}

export const validateDebtPaymentPauses = normalizeDebtPaymentPauses;

type PauseSource = readonly DebtPaymentPause[] | { debt_payment_pauses?: readonly DebtPaymentPause[] | null } | null | undefined;

export function activeDebtPaymentPause(source: PauseSource, date: string): DebtPaymentPause | undefined {
  const pauses = Array.isArray(source)
    ? source as readonly DebtPaymentPause[]
    : (source as { debt_payment_pauses?: readonly DebtPaymentPause[] | null } | null | undefined)?.debt_payment_pauses;
  return pauses?.find(pause => pause.start_date <= date && date < pause.resume_date);
}

export function isDebtPaymentPaused(source: PauseSource, date: string): boolean {
  return activeDebtPaymentPause(source, date) !== undefined;
}

export function addDebtPaymentPause(existing: unknown, pause: DebtPaymentPause): DebtPaymentPause[] {
  return normalizeDebtPaymentPauses([...normalizeDebtPaymentPauses(existing), pause]);
}

/** Shorten an interval when the owner resumes early; retain the completed history. */
export function resumeDebtPaymentPause(existing: unknown, pauseId: string, resumeDate: string): DebtPaymentPause[] {
  const pauses = normalizeDebtPaymentPauses(existing);
  const pause = pauses.find(item => item.id === pauseId);
  if (!pause) throw new Error("This debt payment pause could not be found. Refresh and try again.");
  if (!isDebtPaymentPauseDate(resumeDate) || resumeDate <= pause.start_date || resumeDate > pause.resume_date) {
    throw new Error("The resume date must be after the pause starts and no later than its saved resume date.");
  }
  return normalizeDebtPaymentPauses(pauses.map(item => item.id === pauseId ? { ...item, resume_date: resumeDate } : item));
}

export type PagedQueryError = { message: string };

export type PagedQueryResult<T> = {
  data: T[] | null;
  error: PagedQueryError | null;
};

export type DateIdCursor = { date: string; id: string };

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES = 10_000;

function validDateIdCursor(cursor: DateIdCursor): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) || !cursor.id) return false;
  const [year, month, day] = cursor.date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isStrictlyOlderDateId(row: DateIdCursor, cursor: DateIdCursor): boolean {
  return row.date < cursor.date || (row.date === cursor.date && row.id < cursor.id);
}

export function dateIdKeysetFilter(cursor: DateIdCursor): string {
  if (!validDateIdCursor(cursor)) throw new Error("A valid transaction cursor is required.");
  const quotedId = `"${cursor.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `date.lt.${cursor.date},and(date.eq.${cursor.date},id.lt.${quotedId})`;
}

/**
 * Loads a live date-descending ledger without offset drift. A row inserted at
 * the head after page one cannot shift or hide any older page.
 */
export async function loadAllDateIdKeysetRows<T extends DateIdCursor>(
  loadPage: (cursor: DateIdCursor | null, limit: number) => PromiseLike<PagedQueryResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PagedQueryResult<T>> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("PostgREST page size must be an integer from 1 to 1000.");
  }

  const rows: T[] = [];
  let cursor: DateIdCursor | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await loadPage(cursor, pageSize);
    if (result.error) return { data: null, error: result.error };
    const pageRows = result.data ?? [];
    if (pageRows.length > pageSize) {
      return { data: null, error: { message: "Paged query returned more rows than requested." } };
    }
    let previous: DateIdCursor | null = cursor;
    for (const row of pageRows) {
      const next = { date: row.date, id: row.id };
      if (!validDateIdCursor(next) || (previous && !isStrictlyOlderDateId(next, previous))) {
        return { data: null, error: { message: "Paged query order changed while loading." } };
      }
      rows.push(row);
      previous = next;
    }
    if (pageRows.length < pageSize) return { data: rows, error: null };
    cursor = previous;
  }

  return {
    data: null,
    error: { message: "Paged query exceeded the safety limit." },
  };
}

/**
 * Loads every PostgREST page without relying on the project's server-side
 * max_rows setting. Callers must apply a deterministic order before `range`.
 */
export async function loadAllPagedRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PagedQueryResult<T>> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("PostgREST page size must be an integer from 1 to 1000.");
  }

  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const result = await loadPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }

  return {
    data: null,
    error: { message: "Paged query exceeded the safety limit." },
  };
}

export function appendUniqueRowsById<T extends { id: string }>(existing: T[], next: T[]) {
  const rows = new Map(existing.map((row) => [row.id, row]));
  next.forEach((row) => rows.set(row.id, row));
  return Array.from(rows.values());
}

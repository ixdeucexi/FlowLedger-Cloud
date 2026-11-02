/** Hide only wholly out-of-month trailing weeks; preserve original cells and dates. */
export function openCalendarMonthCells<T extends { inCurrentMonth: boolean }>(cells: readonly T[]): T[] {
  let last = cells.length - 1;
  while (last >= 0 && !cells[last].inCurrentMonth) last -= 1;
  return cells.slice(0, Math.ceil((last + 1) / 7) * 7);
}

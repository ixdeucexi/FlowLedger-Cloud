export function chipScrollMaximum(viewportWidth: number, contentWidth: number): number {
  return Math.max(0, contentWidth - viewportWidth);
}

/** Visit each measured chip boundary; scrolling never chooses a chip. */
export function adjacentChipScrollOffset(offset: number, viewportWidth: number, contentWidth: number, direction: -1 | 1, chipOffsets: readonly number[]): number {
  const maximum = chipScrollMaximum(viewportWidth, contentWidth);
  const current = Math.max(0, Math.min(maximum, offset));
  const boundaries = chipOffsets.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!boundaries.length) return current;
  const adjacent = direction > 0
    ? boundaries.find(boundary => boundary > current + 1) ?? maximum
    : boundaries.filter(boundary => boundary < current - 1).at(-1) ?? 0;
  return Math.max(0, Math.min(maximum, adjacent));
}

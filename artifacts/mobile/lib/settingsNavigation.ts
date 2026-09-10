/** Empty is an explicit Back-to-Settings request, not a missing preference. */
export function requestedSettingsSection(
  routeSection: string | string[] | undefined,
  initialSection: string | undefined,
  browserSearch?: string,
): string | undefined {
  const routeValue = Array.isArray(routeSection) ? routeSection[0] : routeSection;
  const requested = routeValue ?? initialSection;
  if (requested !== undefined) return requested === "" ? "overview" : requested;
  if (browserSearch !== undefined) {
    const browserValue = new URLSearchParams(browserSearch).get("section");
    if (browserValue !== null) return browserValue === "" ? "overview" : browserValue;
  }
  return undefined;
}

export function createSettingsRestoreGuard() {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    begin() { generation += 1; return generation; },
    isCurrent(expected: number) { return generation === expected; },
  };
}

/** Never let a late preference read override newer navigation or identity. */
export async function restoreSavedSettingsSection<T extends string>({
  read,
  isCurrent,
  isSection,
  apply,
  overview,
}: {
  read: () => Promise<{ settingsSection?: string }>;
  isCurrent: () => boolean;
  isSection: (value: unknown) => value is T;
  apply: (section: T) => void;
  overview: T;
}) {
  let saved: unknown;
  try { saved = (await read()).settingsSection; } catch { saved = undefined; }
  if (isCurrent()) apply(isSection(saved) ? saved : overview);
}

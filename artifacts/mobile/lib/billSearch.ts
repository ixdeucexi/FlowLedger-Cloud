/** Match every search word without changing bill order or financial totals. */
export function matchesBillSearch(
  bill: { name: string; category: string },
  query: string,
): boolean {
  const normalized = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const haystack = normalized(`${bill.name} ${bill.category}`);
  return normalized(query)
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export function accountDeletionStorageKeyShouldBeRemoved(key: string, userId: string): boolean {
  const normalized = String(key || "").toLowerCase();
  return normalized.startsWith("flowledger")
    || normalized.startsWith("sb-")
    || normalized.includes(String(userId || "").toLowerCase());
}

export type AuthStorageBackend = "web" | "secure" | "unavailable";

export function selectAuthStorageBackend(
  platform: string,
  secureStoreAvailable: boolean,
): AuthStorageBackend {
  if (platform === "web") return "web";
  return secureStoreAvailable ? "secure" : "unavailable";
}

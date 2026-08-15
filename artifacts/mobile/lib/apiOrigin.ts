export const FLOWLEDGER_PRODUCTION_ORIGIN = "https://flowledger-algo.com";

export function cleanApiOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function joinApiUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/+$/, "")}${normalizedPath}`;
}

export function isReleaseApiOriginSafe(origin: string): boolean {
  return /^https:\/\//i.test(origin) && !/localhost|127\.0\.0\.1|replit/i.test(origin);
}

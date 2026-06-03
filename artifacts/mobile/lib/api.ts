const DEV_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
const PROD_BASE = process.env.EXPO_PUBLIC_API_URL ?? DEV_BASE;

export const API_BASE = __DEV__ ? DEV_BASE : PROD_BASE;

export async function apiFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await apiFetch(path, token);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, token, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, token, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string, token: string): Promise<void> {
  const res = await apiFetch(path, token, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

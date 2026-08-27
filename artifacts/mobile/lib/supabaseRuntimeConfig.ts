const DISABLED_SUPABASE_URL = "https://configuration.invalid";
const DISABLED_SUPABASE_ANON_KEY = "configuration-missing";

export interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
  configured: boolean;
  error: string | null;
}
function validSupabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
      && parsed.pathname === "/"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

export function resolveSupabaseRuntimeConfig(
  urlValue: string | undefined,
  anonKeyValue: string | undefined,
): SupabaseRuntimeConfig {
  const url = urlValue?.trim() ?? "";
  const anonKey = anonKeyValue?.trim() ?? "";
  if (!url || !anonKey) {
    return {
      url: DISABLED_SUPABASE_URL,
      anonKey: DISABLED_SUPABASE_ANON_KEY,
      configured: false,
      error: "This build is missing its secure data-service configuration.",
    };
  }
  if (!validSupabaseUrl(url)) {
    return {
      url: DISABLED_SUPABASE_URL,
      anonKey: DISABLED_SUPABASE_ANON_KEY,
      configured: false,
      error: "This build has an invalid data-service configuration.",
    };
  }
  return { url, anonKey, configured: true, error: null };
}

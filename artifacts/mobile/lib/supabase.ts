import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { authStorage } from "@/lib/secureAuthStorage";
import { guardedMutationFetch } from "@/lib/networkStatus";
import { resolveSupabaseRuntimeConfig } from "@/lib/supabaseRuntimeConfig";

const publicConfig = resolveSupabaseRuntimeConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

export const supabaseUrl = publicConfig.url;
export const supabaseAnonKey = publicConfig.anonKey;
export const supabaseConfigured = publicConfig.configured;
export const supabaseConfigurationError = publicConfig.error;
const supabaseProjectReference = supabaseUrl.replace(/^https?:\/\//i, "").split(".")[0];
export const supabaseAuthStorageKey = `sb-${supabaseProjectReference}-auth-token`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: guardedMutationFetch(globalThis.fetch.bind(globalThis)) },
  auth: {
    storage:            authStorage,
    storageKey:         supabaseAuthStorageKey,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: Platform.OS === "web",
  },
});

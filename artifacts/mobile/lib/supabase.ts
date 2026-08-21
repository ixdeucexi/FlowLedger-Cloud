import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { authStorage } from "@/lib/secureAuthStorage";
import { guardedMutationFetch } from "@/lib/networkStatus";

const FALLBACK_SUPABASE_URL = "https://imqmhfdquqlqxgtcdbvc.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_kb_FiHZBWCn-xS-7A-g6-Q_kRFA873F";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
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

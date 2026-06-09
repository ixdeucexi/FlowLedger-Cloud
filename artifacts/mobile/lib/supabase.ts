import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;

// Hardcoded fallbacks ensure credentials are always available even when
// Constants.expoConfig.extra or EXPO_PUBLIC_* env vars are undefined at runtime.
const FALLBACK_URL  = "https://imqmhfdquqlqxgtcdbvc.supabase.co";
const FALLBACK_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltcW1oZmRxdXFscXhndGNkYnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTcwMTIsImV4cCI6MjA5NjU3MzAxMn0.lcjjNxrhhip6ZQfyk2qfTSZA8blN2ipNJYFAbCbeSp0";

const supabaseUrl  = (extra?.supabaseUrl  || process.env.EXPO_PUBLIC_SUPABASE_URL  || FALLBACK_URL).trim();
const supabaseAnon = (extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON).trim();

if (__DEV__) {
  console.log("[supabase] URL:", supabaseUrl);
  console.log("[supabase] Key starts with:", supabaseAnon.slice(0, 20));
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage:            AsyncStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});

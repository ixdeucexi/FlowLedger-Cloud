import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;

const supabaseUrl  = extra?.supabaseUrl  ?? process.env.EXPO_PUBLIC_SUPABASE_URL  ?? "";
const supabaseAnon = extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Explicitly pass globalThis.fetch so Supabase uses React Native's native
// fetch, not the whatwg-fetch/cross-fetch browser polyfill (which breaks on iOS).
const nativeFetch = globalThis.fetch.bind(globalThis);

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage:            AsyncStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: nativeFetch,
  },
});

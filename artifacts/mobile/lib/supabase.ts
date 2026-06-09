import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
} | undefined;

const supabaseUrl  = extra?.supabaseUrl  ?? "";
const supabaseAnon = extra?.supabaseAnonKey ?? "";

if (!supabaseUrl || !supabaseAnon) {
  console.warn("Supabase credentials missing from app config extra. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY env vars.");
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage:            AsyncStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});

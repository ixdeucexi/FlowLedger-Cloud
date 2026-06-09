import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;

const supabaseUrl  = extra?.supabaseUrl  ?? process.env.EXPO_PUBLIC_SUPABASE_URL  ?? "";
const supabaseAnon = extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    storage:            AsyncStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
});

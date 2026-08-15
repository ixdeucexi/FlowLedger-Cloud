import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";

import { supabase } from "@/lib/supabase";

export const nativeAuthRedirectUri = makeRedirectUri({
  scheme: "flowledger",
  path: "auth/callback",
});

export const nativePasswordResetRedirectUri = makeRedirectUri({
  scheme: "flowledger",
  path: "auth/reset-password",
});

export async function completeSupabaseAuthUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const code = typeof params.code === "string" ? params.code : null;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }

  const accessToken = typeof params.access_token === "string" ? params.access_token : null;
  const refreshToken = typeof params.refresh_token === "string" ? params.refresh_token : null;
  if (!accessToken || !refreshToken) return null;
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return data.session;
}

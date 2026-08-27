import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  DISABLED_API_ORIGIN,
  joinApiUrl,
  resolveNativeApiOrigin,
} from "./apiOrigin";
import { assertMutationOnline } from "./networkStatus";

export { FLOWLEDGER_PRODUCTION_ORIGIN, isReleaseApiOriginSafe } from "./apiOrigin";

export function configuredApiOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return resolveNativeApiOrigin(
    process.env.EXPO_PUBLIC_API_ORIGIN,
    Constants.expoConfig?.extra?.apiOrigin,
  ) ?? DISABLED_API_ORIGIN;
}

export function apiConfigurationError(): string | null {
  if (Platform.OS === "web") return null;
  return resolveNativeApiOrigin(
    process.env.EXPO_PUBLIC_API_ORIGIN,
    Constants.expoConfig?.extra?.apiOrigin,
  )
    ? null
    : "This build is missing its secure API configuration.";
}

export function apiUrl(path: string): string {
  return joinApiUrl(configuredApiOrigin(), path);
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const configurationError = apiConfigurationError();
  if (configurationError) return Promise.reject(new Error(configurationError));
  assertMutationOnline(path, init);
  return fetch(apiUrl(path), init);
}

import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  cleanApiOrigin,
  FLOWLEDGER_PRODUCTION_ORIGIN,
  joinApiUrl,
} from "./apiOrigin";
import { assertMutationOnline } from "./networkStatus";

export { FLOWLEDGER_PRODUCTION_ORIGIN, isReleaseApiOriginSafe } from "./apiOrigin";

export function configuredApiOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return cleanApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN)
    ?? cleanApiOrigin(Constants.expoConfig?.extra?.apiOrigin)
    ?? FLOWLEDGER_PRODUCTION_ORIGIN;
}

export function apiUrl(path: string): string {
  return joinApiUrl(configuredApiOrigin(), path);
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  assertMutationOnline(path, init);
  return fetch(apiUrl(path), init);
}

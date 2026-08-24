import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api";
import { accountDeletionStorageKeyShouldBeRemoved } from "@/lib/accountDeletionPolicy";
import { authStorage } from "@/lib/secureAuthStorage";
import { supabaseAuthStorageKey } from "@/lib/supabase";

export { accountDeletionStorageKeyShouldBeRemoved } from "@/lib/accountDeletionPolicy";

export type AccountDeletionReceipt = {
  receiptId: string;
  status: "data_deleted" | "completed";
  requestedAt?: string;
  dataDeletedAt?: string;
  authDeletedAt?: string;
  plaidItemsRevoked?: number;
  ownedHouseholdsDeleted?: number;
  membershipsRemoved?: number;
};

export async function purgeFlowLedgerCacheExports(): Promise<void> {
  if (Platform.OS === "web" || !FileSystem.cacheDirectory) return;
  const names = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory).catch(() => [] as string[]);
  await Promise.all(names
    .filter(name => /^flowledger-backup-.*\.csv$/i.test(name))
    .map(name => FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, { idempotent: true }).catch(() => undefined)));
}

export async function clearDeletedAccountStorage(userId: string): Promise<void> {
  await purgeFlowLedgerCacheExports();
  await authStorage.removeItem(supabaseAuthStorageKey).catch(() => undefined);
  const keys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
  const remove = keys.filter(key => accountDeletionStorageKeyShouldBeRemoved(key, userId));
  if (remove.length) await AsyncStorage.multiRemove(remove).catch(() => undefined);

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const webKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key));
    webKeys
      .filter(key => accountDeletionStorageKeyShouldBeRemoved(key, userId))
      .forEach(key => window.localStorage.removeItem(key));
  }
}

export async function deleteFlowLedgerAccount(accessToken: string): Promise<AccountDeletionReceipt> {
  const response = await apiFetch("/api/account/delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  const payload = await response.json().catch(() => ({})) as {
    receipt?: AccountDeletionReceipt;
    receiptId?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.message || "Your account was not deleted. Please try again.");
    (error as Error & { receiptId?: string; code?: string }).receiptId = payload.receiptId;
    (error as Error & { receiptId?: string; code?: string }).code = payload.error;
    throw error;
  }
  if (!payload.receipt?.receiptId) throw new Error("The deletion receipt was missing. Contact support before retrying.");
  return payload.receipt;
}

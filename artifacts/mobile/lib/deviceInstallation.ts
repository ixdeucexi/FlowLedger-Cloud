import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const INSTALLATION_ID_KEY = "flowledger-installation-id";

export async function getInstallationId(): Promise<string> {
  const stored = await AsyncStorage.getItem(INSTALLATION_ID_KEY).catch(() => null);
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

export async function clearInstallationId(): Promise<void> {
  await AsyncStorage.removeItem(INSTALLATION_ID_KEY).catch(() => undefined);
}

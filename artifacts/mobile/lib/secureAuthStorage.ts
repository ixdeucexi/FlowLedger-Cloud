import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { parseSecureAuthManifest, splitSecureAuthValue, type SecureAuthManifest } from "@/lib/secureAuthStorageCodec";

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function nativeSecureStoreAvailable() {
  return SecureStore.isAvailableAsync().catch(() => false);
}

function manifestKey(key: string) {
  return `${key}.manifest`;
}

function chunkKey(key: string, generation: string, index: number) {
  return `${key}.chunk.${generation}.${index}`;
}

async function deleteNativeGeneration(key: string, manifest: SecureAuthManifest | null) {
  if (!manifest) return;
  await Promise.all(Array.from({ length: manifest.chunks }, (_, index) => (
    SecureStore.deleteItemAsync(chunkKey(key, manifest.generation, index), secureOptions).catch(() => undefined)
  )));
}

async function readNativeValue(key: string): Promise<string | null> {
  const manifest = parseSecureAuthManifest(await SecureStore.getItemAsync(manifestKey(key), secureOptions));
  if (manifest) {
    const chunks = await Promise.all(Array.from({ length: manifest.chunks }, (_, index) => (
      SecureStore.getItemAsync(chunkKey(key, manifest.generation, index), secureOptions)
    )));
    if (chunks.every((chunk): chunk is string => chunk !== null)) return chunks.join("");
    return null;
  }
  return SecureStore.getItemAsync(key, secureOptions);
}

async function writeNativeValue(key: string, value: string): Promise<void> {
  const previous = parseSecureAuthManifest(await SecureStore.getItemAsync(manifestKey(key), secureOptions));
  const generation = Crypto.randomUUID();
  const chunks = splitSecureAuthValue(value);
  for (let index = 0; index < chunks.length; index += 1) {
    await SecureStore.setItemAsync(chunkKey(key, generation, index), chunks[index], secureOptions);
  }
  const next: SecureAuthManifest = { version: 1, generation, chunks: chunks.length };
  await SecureStore.setItemAsync(manifestKey(key), JSON.stringify(next), secureOptions);
  await SecureStore.deleteItemAsync(key, secureOptions).catch(() => undefined);
  await deleteNativeGeneration(key, previous);
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web" || !(await nativeSecureStoreAvailable())) {
      return AsyncStorage.getItem(key);
    }
    const secured = await readNativeValue(key);
    if (secured !== null) return secured;

    // One-time migration for people who installed a preview before encrypted
    // session storage was enabled. Never keep two native session copies.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await writeNativeValue(key, legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web" || !(await nativeSecureStoreAvailable())) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    await writeNativeValue(key, value);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS !== "web" && await nativeSecureStoreAvailable()) {
      const manifest = parseSecureAuthManifest(await SecureStore.getItemAsync(manifestKey(key), secureOptions).catch(() => null));
      await deleteNativeGeneration(key, manifest);
      await SecureStore.deleteItemAsync(manifestKey(key), secureOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(key, secureOptions).catch(() => undefined);
    }
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
};

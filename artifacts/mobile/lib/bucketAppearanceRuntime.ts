import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DocumentPickerAsset } from "expo-document-picker";
import {
  BUCKET_APPEARANCE_PREFIX,
  bucketAppearanceKey,
  withBucketLook,
  type BucketAppearanceScope,
  type BucketLook,
} from "./bucketAppearance";
import { BucketAppearanceStore } from "./bucketAppearanceStore";
import {
  clearBucketPhotosForUser,
  deleteBucketPhoto,
  persistBucketPhoto,
} from "./bucketPhotoStorage";

const stores = new Map<string, BucketAppearanceStore>();
export function getBucketAppearanceStore(
  scope: BucketAppearanceScope,
): BucketAppearanceStore {
  const key = bucketAppearanceKey(scope);
  let store = stores.get(key);
  if (!store) {
    store = new BucketAppearanceStore({
      read: () => AsyncStorage.getItem(key),
      write: (raw) => AsyncStorage.setItem(key, raw),
    });
    stores.set(key, store);
  }
  return store;
}
export async function saveBucketLook(
  scope: BucketAppearanceScope,
  goalId: string,
  patch: Partial<BucketLook>,
  current: () => boolean,
) {
  const store = getBucketAppearanceStore(scope);
  const replaced = await store.change(async (data) => {
    const previous = data.looks[goalId];
    const next = withBucketLook(data, goalId, patch);
    return {
      data: next,
      value:
        previous?.photoId !== next.looks[goalId].photoId
          ? previous?.photoId
          : undefined,
    };
  }, current);
  if (replaced) await deleteBucketPhoto(scope, replaced).catch(() => undefined);
}
export async function saveBucketPhoto(
  scope: BucketAppearanceScope,
  goalId: string,
  asset: DocumentPickerAsset,
  current: () => boolean,
) {
  const store = getBucketAppearanceStore(scope);
  let photoId: string | null = null,
    committed = false;
  try {
    const replaced = await store.change(async (data) => {
      photoId = await persistBucketPhoto(scope, asset);
      const previous = data.looks[goalId];
      const next = withBucketLook(data, goalId, { photoId });
      return { data: next, value: previous?.photoId };
    }, current);
    committed = true;
    if (replaced)
      await deleteBucketPhoto(scope, replaced).catch(() => undefined);
  } finally {
    if (!committed && photoId)
      await deleteBucketPhoto(scope, photoId).catch(() => undefined);
  }
}
export async function clearBucketAppearanceForUser(userId: string) {
  const prefix = `${BUCKET_APPEARANCE_PREFIX}${userId}:`;
  const entries = [...stores].filter(([key]) => key.startsWith(prefix));
  await Promise.all(
    entries.map(async ([key, store]) => {
      await store.dispose();
      stores.delete(key);
    }),
  );
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(prefix),
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
  await clearBucketPhotosForUser(userId);
}

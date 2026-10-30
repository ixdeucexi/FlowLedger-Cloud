import { Image, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  bucketAppearanceKey,
  validBucketPhotoId,
  validateBucketPhoto,
  MAX_BUCKET_PHOTO_BYTES,
  type BucketAppearanceScope,
} from "./bucketAppearance";

const DATABASE = "flowledger-bucket-photos-v1";
type PhotoRecord = { id: string; userId: string; scope: string; blob: Blob };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Photo storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("photos", {
        keyPath: "id",
      });
      store.createIndex("userId", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Couldn’t open photo storage. Your previous look is unchanged.",
        ),
      );
    request.onblocked = () =>
      reject(
        new Error("Close other FlowLedger tabs and try photo storage again."),
      );
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("photos", mode);
    let value: T;
    transaction.oncomplete = () => {
      db.close();
      resolve(value!);
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          "Couldn’t save or read this photo. Check device storage and try again.",
        ),
      );
    };
    try {
      run(transaction.objectStore("photos"), (next) => {
        value = next;
      });
    } catch (cause) {
      db.close();
      reject(cause);
    }
  });
}
function recordId(scope: BucketAppearanceScope, photoId: string) {
  return `${bucketAppearanceKey(scope)}/${photoId}`;
}
async function nativeDirectory(scope: BucketAppearanceScope) {
  bucketAppearanceKey(scope);
  const fs = await import("expo-file-system");
  return {
    fs,
    directory: new fs.Directory(
      fs.Paths.document,
      "bucket-photos",
      scope.userId,
      scope.householdId,
      scope.budgetId,
    ),
  };
}
export async function chooseBucketPhoto(): Promise<DocumentPicker.DocumentPickerAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "image/webp"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  return result.canceled ? null : (result.assets[0] ?? null);
}
export async function releasePickedBucketPhoto(
  asset: DocumentPicker.DocumentPickerAsset,
) {
  if (Platform.OS === "web") {
    if (asset.uri.startsWith("blob:")) URL.revokeObjectURL(asset.uri);
    return;
  }
  const fs = await import("expo-file-system");
  if (
    asset.uri.startsWith(fs.Paths.cache.uri) &&
    asset.uri.includes("/DocumentPicker/")
  ) {
    const file = new fs.File(asset.uri);
    if (file.exists) await file.delete();
  }
}
export async function persistBucketPhoto(
  scope: BucketAppearanceScope,
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<string> {
  bucketAppearanceKey(scope);
  let header: Uint8Array, size: number, fileBlob: Blob | undefined;
  if (Platform.OS === "web") {
    fileBlob = asset.file;
    if (!fileBlob)
      throw new Error("The selected photo could not be read. Choose it again.");
    size = fileBlob.size;
    if (size <= 0 || size > MAX_BUCKET_PHOTO_BYTES)
      throw new Error("Choose a JPG, PNG, or WebP photo up to 12 MB.");
    header = new Uint8Array(await fileBlob.slice(0, 12).arrayBuffer());
  } else {
    const { fs } = await nativeDirectory(scope);
    const file = new fs.File(asset.uri);
    size = file.size;
    if (size <= 0 || size > MAX_BUCKET_PHOTO_BYTES)
      throw new Error("Choose a JPG, PNG, or WebP photo up to 12 MB.");
    header = (await file.bytes()).subarray(0, 12);
  }
  const ext = validateBucketPhoto(header, size);
  await new Promise<void>((resolve, reject) =>
    Image.getSize(
      asset.uri,
      (width, height) => {
        if (
          width <= 0 ||
          height <= 0 ||
          width > 20000 ||
          height > 20000 ||
          width * height > 80_000_000
        )
          reject(
            new Error(
              "This photo is too large to display. Choose a smaller image.",
            ),
          );
        else resolve();
      },
      () =>
        reject(
          new Error(
            "This photo couldn’t be opened. Choose a different JPG, PNG, or WebP image.",
          ),
        ),
    ),
  );
  const photoId = `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}.${ext}`;
  try {
    if (Platform.OS === "web") {
      await transact<void>("readwrite", (store, result) => {
        store.put({
          id: recordId(scope, photoId),
          userId: scope.userId,
          scope: bucketAppearanceKey(scope),
          blob: fileBlob!,
        } satisfies PhotoRecord);
        result(undefined);
      });
    } else {
      const { fs, directory } = await nativeDirectory(scope);
      await directory.create({ intermediates: true, idempotent: true });
      await new fs.File(asset.uri).copy(new fs.File(directory, photoId));
    }
  } catch (cause) {
    await deleteBucketPhoto(scope, photoId).catch(() => undefined);
    throw cause;
  }
  return photoId;
}
export async function loadBucketPhoto(
  scope: BucketAppearanceScope,
  photoId: string,
): Promise<{ uri: string; release: () => void }> {
  if (!validBucketPhotoId(photoId))
    throw new Error("This saved photo is unavailable.");
  if (Platform.OS === "web") {
    const record = await transact<PhotoRecord | undefined>(
      "readonly",
      (store, result) => {
        const request = store.get(recordId(scope, photoId));
        request.onsuccess = () =>
          result(request.result as PhotoRecord | undefined);
      },
    );
    if (
      !record ||
      record.userId !== scope.userId ||
      record.scope !== bucketAppearanceKey(scope) ||
      !(record.blob instanceof Blob)
    )
      throw new Error(
        "This photo is no longer on this device. Choose it again.",
      );
    validateBucketPhoto(
      new Uint8Array(await record.blob.slice(0, 12).arrayBuffer()),
      record.blob.size,
    );
    const uri = URL.createObjectURL(record.blob);
    return { uri, release: () => URL.revokeObjectURL(uri) };
  }
  const { fs, directory } = await nativeDirectory(scope);
  const file = new fs.File(directory, photoId);
  if (!file.exists)
    throw new Error("This photo is no longer on this device. Choose it again.");
  return { uri: file.uri, release: () => undefined };
}
export async function deleteBucketPhoto(
  scope: BucketAppearanceScope,
  photoId: string,
): Promise<void> {
  if (!validBucketPhotoId(photoId)) return;
  if (Platform.OS === "web")
    await transact<void>("readwrite", (store, result) => {
      store.delete(recordId(scope, photoId));
      result(undefined);
    });
  else {
    const { fs, directory } = await nativeDirectory(scope);
    const file = new fs.File(directory, photoId);
    if (file.exists) await file.delete();
  }
}
export async function clearBucketPhotosForUser(userId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(userId)) return;
  if (Platform.OS === "web") {
    await transact<void>("readwrite", (store, result) => {
      const request = store
        .index("userId")
        .openCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else result(undefined);
      };
    });
  } else {
    const fs = await import("expo-file-system");
    const directory = new fs.Directory(
      fs.Paths.document,
      "bucket-photos",
      userId,
    );
    if (directory.exists) await directory.delete();
  }
}

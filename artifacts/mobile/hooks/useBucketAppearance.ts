import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import {
  bucketAppearanceKey,
  DEFAULT_BUCKET_LOOK,
  type BucketLook,
} from "@/lib/bucketAppearance";
import {
  getBucketAppearanceStore,
  saveBucketLook,
  saveBucketPhoto,
} from "@/lib/bucketAppearanceRuntime";
import {
  chooseBucketPhoto,
  loadBucketPhoto,
  releasePickedBucketPhoto,
} from "@/lib/bucketPhotoStorage";

export function useBucketAppearance(goalId: string) {
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const scope = useMemo(
    () => ({
      userId: user?.id ?? (demoMode ? "demo" : "unavailable"),
      householdId: activeHousehold?.householdId ?? "unavailable",
      budgetId: activeHousehold?.budgetId ?? "unavailable",
    }),
    [
      user?.id,
      demoMode,
      activeHousehold?.householdId,
      activeHousehold?.budgetId,
    ],
  );
  const enabled = Boolean(
    (user || demoMode) &&
    activeHousehold?.householdId &&
    activeHousehold?.budgetId,
  );
  const key = bucketAppearanceKey(scope);
  const store = useMemo(() => getBucketAppearanceStore(scope), [key]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const live = useRef({ key, enabled, mounted: true });
  live.current.key = key;
  live.current.enabled = enabled;
  useEffect(() => {
    live.current.mounted = true;
    if (enabled) void store.load();
    return () => {
      live.current.mounted = false;
    };
  }, [store, enabled]);
  const current = useCallback(
    () =>
      live.current.mounted && live.current.enabled && live.current.key === key,
    [key],
  );
  const look = enabled
    ? (snapshot.data.looks[goalId] ?? DEFAULT_BUCKET_LOOK)
    : DEFAULT_BUCKET_LOOK;
  const update = useCallback(
    (patch: Partial<BucketLook>) =>
      saveBucketLook(scope, goalId, patch, current),
    [key, goalId, current],
  );
  const pickPhoto = useCallback(async () => {
    const asset = await chooseBucketPhoto();
    if (!asset) return;
    try {
      if (current()) await saveBucketPhoto(scope, goalId, asset, current);
    } finally {
      await releasePickedBucketPhoto(asset).catch(() => undefined);
    }
  }, [key, goalId, current]);
  return {
    ...snapshot,
    scope,
    key,
    enabled,
    ready: enabled && snapshot.ready,
    look,
    update,
    pickPhoto,
    retryLoad: () => store.load(true),
    current,
  };
}
export function useBucketPhoto(
  appearance: ReturnType<typeof useBucketAppearance>,
  hidden = false,
) {
  const { key, look, scope } = appearance;
  const [value, setValue] = useState<{
    key: string;
    photoId: string;
    uri: string;
  } | null>(null);
  const [error, setError] = useState<{
    key: string;
    photoId: string;
    message: string;
  } | null>(null);
  const livePhoto = useRef({ key, photoId: look.photoId });
  livePhoto.current = { key, photoId: look.photoId };
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      release: (() => void) | undefined;
    setValue(null);
    setError(null);
    if (!look.photoId || hidden) return;
    const photoId = look.photoId;
    void loadBucketPhoto(scope, photoId)
      .then((photo) => {
        if (!active) {
          photo.release();
          return;
        }
        release = photo.release;
        setValue({ key, photoId, uri: photo.uri });
      })
      .catch((cause) => {
        if (active)
          setError({
            key,
            photoId,
            message:
              cause instanceof Error
                ? cause.message
                : "Couldn’t load this photo.",
          });
      });
    return () => {
      active = false;
      release?.();
    };
  }, [key, look.photoId, retry, hidden]);
  return {
    uri:
      !hidden && value?.key === key && value.photoId === look.photoId
        ? value.uri
        : null,
    error:
      !hidden && error?.key === key && error.photoId === look.photoId
        ? error.message
        : null,
    retry: () => setRetry((v) => v + 1),
    fail: () => {
      if (
        !look.photoId ||
        livePhoto.current.key !== key ||
        livePhoto.current.photoId !== look.photoId
      )
        return;
      setValue(null);
      setError({
        key,
        photoId: look.photoId,
        message:
          "This photo couldn’t be displayed. Retry it or choose another photo.",
      });
    },
  };
}

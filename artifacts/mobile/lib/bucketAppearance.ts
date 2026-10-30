/** Personal presentation only. These fields never enter a goal financial payload. */
export const BUCKET_APPEARANCE_PREFIX = "flowledger_bucket_appearance_v1:";
export const BUCKET_ICONS = [
  "shopping-bag",
  "sun",
  "gift",
  "home",
  "truck",
  "heart",
  "book",
  "coffee",
  "briefcase",
  "shield",
  "map",
  "star",
] as const;
export const BUCKET_COVERS = [
  "none",
  "violet",
  "ocean",
  "forest",
  "sunset",
  "sand",
] as const;
export type BucketIcon = (typeof BUCKET_ICONS)[number];
export type BucketCoverStyle = (typeof BUCKET_COVERS)[number];
export type BucketAppearanceScope = {
  userId: string;
  householdId: string;
  budgetId: string;
};
export type BucketLook = {
  icon: BucketIcon;
  cover: BucketCoverStyle;
  photoId?: string;
  celebrateCompletion: boolean;
};
export type BucketAppearanceData = {
  version: 1;
  looks: Record<string, BucketLook>;
  seen: string[];
};
export const DEFAULT_BUCKET_LOOK: BucketLook = {
  icon: "shopping-bag",
  cover: "none",
  celebrateCompletion: false,
};
export const EMPTY_BUCKET_APPEARANCE: BucketAppearanceData = {
  version: 1,
  looks: {},
  seen: [],
};
export const MAX_BUCKET_PHOTO_BYTES = 12 * 1024 * 1024;
export function validBucketScopePart(value: string) {
  return /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}
/** Legacy plans are user-owned. Never infer that fallback during a scope load. */
export function resolveBucketAppearanceScope(input: {
  userId: string | null;
  household: { householdId?: string | null; budgetId?: string | null } | null;
  loading: boolean;
  loadError: unknown;
}): {
  scope: BucketAppearanceScope | null;
  unavailableReason: string | null;
} {
  if (!input.userId)
    return {
      scope: null,
      unavailableReason: "Sign in to personalize buckets.",
    };
  if (input.loading)
    return {
      scope: null,
      unavailableReason: "Bucket personalization is loading…",
    };
  if (input.loadError)
    return {
      scope: null,
      unavailableReason:
        "Bucket personalization is unavailable until your plan loads.",
    };
  if (
    input.household &&
    (!input.household.householdId || !input.household.budgetId)
  )
    return {
      scope: null,
      unavailableReason:
        "Bucket personalization is unavailable while your budget loads.",
    };
  const scope = {
    userId: input.userId,
    householdId: input.household?.householdId ?? `personal-${input.userId}`,
    budgetId: input.household?.budgetId ?? "personal",
  };
  if (!Object.values(scope).every(validBucketScopePart))
    return {
      scope: null,
      unavailableReason:
        "Bucket personalization is unavailable for this account.",
    };
  return { scope, unavailableReason: null };
}
export function bucketAppearanceKey(scope: BucketAppearanceScope) {
  if (
    ![scope.userId, scope.householdId, scope.budgetId].every(
      validBucketScopePart,
    )
  )
    throw new Error("Choose a household before personalizing buckets.");
  return `${BUCKET_APPEARANCE_PREFIX}${scope.userId}:${scope.householdId}:${scope.budgetId}`;
}
export function validBucketPhotoId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^photo-[a-z0-9-]{8,80}\.(jpg|png|webp)$/.test(value)
  );
}
export function validBucketLookId(value: string) {
  return (
    /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}
export function normalizeBucketLook(value: unknown): BucketLook {
  const v =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    icon: BUCKET_ICONS.includes(v.icon as BucketIcon)
      ? (v.icon as BucketIcon)
      : "shopping-bag",
    cover: BUCKET_COVERS.includes(v.cover as BucketCoverStyle)
      ? (v.cover as BucketCoverStyle)
      : "none",
    ...(validBucketPhotoId(v.photoId) ? { photoId: v.photoId } : {}),
    celebrateCompletion: v.celebrateCompletion === true,
  };
}
export function normalizeBucketAppearance(
  value: unknown,
): BucketAppearanceData {
  const v =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (v.version !== 1) return { version: 1, looks: {}, seen: [] };
  const looks: Record<string, BucketLook> = {};
  if (v.looks && typeof v.looks === "object" && !Array.isArray(v.looks)) {
    for (const [id, look] of Object.entries(v.looks).slice(0, 500)) {
      if (validBucketLookId(id)) looks[id] = normalizeBucketLook(look);
    }
  }
  const seen = Array.isArray(v.seen)
    ? [
        ...new Set(
          v.seen.filter(
            (x): x is string => typeof x === "string" && x.length <= 200,
          ),
        ),
      ].slice(-500)
    : [];
  return { version: 1, looks, seen };
}
export function parseBucketAppearance(
  raw: string | null,
): BucketAppearanceData {
  if (!raw) return { version: 1, looks: {}, seen: [] };
  if (raw.length > 180_000)
    throw new Error(
      "Saved bucket appearance is too large. Reset it or try again.",
    );
  return normalizeBucketAppearance(JSON.parse(raw));
}
export function withBucketLook(
  data: BucketAppearanceData,
  goalId: string,
  patch: Partial<BucketLook>,
): BucketAppearanceData {
  if (!validBucketLookId(goalId))
    throw new Error("This bucket is unavailable. Open it again.");
  if (
    !Object.hasOwn(data.looks, goalId) &&
    Object.keys(data.looks).length >= 500
  )
    throw new Error(
      "This device has too many personalized buckets. Reset an old look before adding another.",
    );
  return {
    ...data,
    looks: {
      ...data.looks,
      [goalId]: normalizeBucketLook({ ...data.looks[goalId], ...patch }),
    },
  };
}
export function photoSignature(
  bytes: Uint8Array,
): "jpg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x))
    return "png";
  if (
    [82, 73, 70, 70].every((x, i) => bytes[i] === x) &&
    [87, 69, 66, 80].every((x, i) => bytes[i + 8] === x)
  )
    return "webp";
  return null;
}
export function validateBucketPhoto(bytes: Uint8Array, size: number) {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BUCKET_PHOTO_BYTES)
    throw new Error("Choose a JPG, PNG, or WebP photo up to 12 MB.");
  const kind = photoSignature(bytes);
  if (!kind)
    throw new Error(
      "This file is not a supported photo. Choose a JPG, PNG, or WebP image.",
    );
  return kind;
}
export type MilestoneGoal = {
  id: string;
  name: string;
  goal_type: string;
  target_amount: number;
  current_amount: number;
  closed_at?: string | null;
  archived_at?: string | null;
};
export type BucketMilestone = {
  key: string;
  goalId: string;
  name: string;
  label: "Bucket complete" | "Goal funded";
};
export function eligibleBucketMilestone(
  goal: MilestoneGoal,
): BucketMilestone | null {
  if (goal.archived_at) return null;
  if (goal.goal_type === "planned_expense")
    return goal.closed_at
      ? {
          key: `${goal.id}:closed:${goal.closed_at}`,
          goalId: goal.id,
          name: goal.name,
          label: "Bucket complete",
        }
      : null;
  if (
    goal.goal_type === "savings" &&
    Number.isFinite(goal.target_amount) &&
    Number.isFinite(goal.current_amount) &&
    goal.target_amount > 0 &&
    goal.current_amount + 0.005 >= goal.target_amount
  )
    return {
      key: `${goal.id}:funded:${goal.target_amount}`,
      goalId: goal.id,
      name: goal.name,
      label: "Goal funded",
    };
  return null;
}
export function newBucketMilestones(
  previous: readonly MilestoneGoal[] | null,
  current: readonly MilestoneGoal[],
  data: BucketAppearanceData,
): BucketMilestone[] {
  if (!previous) return [];
  const old = new Map(
    previous.map((g) => [g.id, eligibleBucketMilestone(g)?.key]),
  );
  return current.flatMap((goal) => {
    const event = eligibleBucketMilestone(goal);
    return event &&
      old.has(goal.id) &&
      old.get(goal.id) !== event.key &&
      data.looks[goal.id]?.celebrateCompletion &&
      !data.seen.includes(event.key)
      ? [event]
      : [];
  });
}
export type MilestoneObservation = {
  key: string;
  goals: MilestoneGoal[];
} | null;
/** Saving goals can be optimistic. Only a confirmed save may produce a moment. */
export function observeBucketMilestones(
  previous: MilestoneObservation,
  key: string,
  goals: readonly MilestoneGoal[],
  data: BucketAppearanceData,
  state: {
    ready: boolean;
    saving: boolean;
    failed: boolean;
    confirmed: boolean;
  },
) {
  if (!state.ready) return { previous: null, events: [] as BucketMilestone[] };
  const scopedPrevious = previous?.key === key ? previous : null;
  // A failed write can be retried while the global banner still says "failed".
  // Keep the pre-save baseline until that retry is confirmed, without observing
  // optimistic values or letting another household's baseline follow the retry.
  if (state.saving || state.failed)
    return { previous: scopedPrevious, events: [] as BucketMilestone[] };
  const before = scopedPrevious?.goals ?? null;
  return {
    previous: { key, goals: goals.map((goal) => ({ ...goal })) },
    events: state.confirmed ? newBucketMilestones(before, goals, data) : [],
  };
}

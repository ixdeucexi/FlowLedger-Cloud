import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "flowledger-plan-cache-v1";
const MAX_CACHE_BYTES = 4_500_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface BudgetPlanCacheData {
  bills: unknown[];
  overrides: unknown[];
  billDateMoves: unknown[];
  transactions: unknown[];
  deletedTransactions: unknown[];
  pendingBankTransactions: unknown[];
  pendingPlanMatches: unknown[];
  incomes: unknown[];
  goals: unknown[];
  extraPayments: unknown[];
  categories: string[];
  accounts: unknown[];
  connectedBankAccounts: unknown[];
  dailyCheckingCloses: unknown[];
  householdTimeZone: string;
  transactionAccountIdentities: unknown[];
  decisions: unknown[];
  settings: Record<string, unknown>;
}

export interface CachedHouseholdMembership {
  householdId: string;
  budgetId: string | null;
  name: string;
  isPersonal: boolean;
  role: "owner" | "manager" | "editor" | "viewer";
}

export interface BudgetPlanCacheRecord {
  version: 1;
  userId: string;
  household: CachedHouseholdMembership;
  households: CachedHouseholdMembership[];
  savedAt: string;
  dataUpdatedAt: string;
  data: BudgetPlanCacheData;
}

interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

function cleanScopePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

export function budgetPlanCacheKey(userId: string, householdId: string) {
  return `${CACHE_PREFIX}:${cleanScopePart(userId)}:${cleanScopePart(householdId)}`;
}

function validHousehold(value: unknown): value is CachedHouseholdMembership {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CachedHouseholdMembership>;
  return typeof item.householdId === "string"
    && item.householdId.length > 0
    && (typeof item.budgetId === "string" || item.budgetId === null)
    && typeof item.name === "string"
    && typeof item.isPersonal === "boolean"
    && ["owner", "manager", "editor", "viewer"].includes(String(item.role));
}

const ARRAY_FIELDS: Array<keyof BudgetPlanCacheData> = [
  "bills",
  "overrides",
  "billDateMoves",
  "transactions",
  "deletedTransactions",
  "pendingBankTransactions",
  "pendingPlanMatches",
  "incomes",
  "goals",
  "extraPayments",
  "categories",
  "accounts",
  "connectedBankAccounts",
  "dailyCheckingCloses",
  "transactionAccountIdentities",
  "decisions",
];

function validCacheData(value: unknown): value is BudgetPlanCacheData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<BudgetPlanCacheData>;
  if (!ARRAY_FIELDS.every(field => Array.isArray(data[field]))) return false;
  if ((data.transactions?.length ?? 0) > 20_000) return false;
  if ((data.bills?.length ?? 0) > 5_000) return false;
  if ((data.categories as unknown[] | undefined)?.some(item => typeof item !== "string")) return false;
  if (ARRAY_FIELDS
    .filter(field => field !== "categories")
    .some(field => (data[field] as unknown[]).some(item => !item || typeof item !== "object"))) {
    return false;
  }
  return typeof data.householdTimeZone === "string"
    && data.householdTimeZone.length <= 100
    && Boolean(data.settings)
    && typeof data.settings === "object"
    && !Array.isArray(data.settings);
}

export function parseBudgetPlanCache(
  raw: string | null,
  expectedUserId: string,
  expectedHouseholdId: string,
  now = Date.now(),
): BudgetPlanCacheRecord | null {
  if (!raw || raw.length > MAX_CACHE_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BudgetPlanCacheRecord>;
    if (
      parsed.version !== 1
      || parsed.userId !== expectedUserId
      || !validHousehold(parsed.household)
      || parsed.household.householdId !== expectedHouseholdId
      || !Array.isArray(parsed.households)
      || !parsed.households.every(validHousehold)
      || !parsed.households.some(item => item.householdId === expectedHouseholdId)
      || typeof parsed.savedAt !== "string"
      || typeof parsed.dataUpdatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.savedAt))
      || !Number.isFinite(Date.parse(parsed.dataUpdatedAt))
      || Date.parse(parsed.savedAt) > now + MAX_CLOCK_SKEW_MS
      || Date.parse(parsed.dataUpdatedAt) > now + MAX_CLOCK_SKEW_MS
      || !validCacheData(parsed.data)
    ) return null;
    return parsed as BudgetPlanCacheRecord;
  } catch {
    return null;
  }
}

export function budgetPlanCacheCanHydrateBeforeMembership(
  cache: BudgetPlanCacheRecord,
) {
  return cache.household.isPersonal && cache.household.role === "owner";
}

export async function readBudgetPlanCache(
  userId: string,
  householdId: string,
  storage: CacheStorage = AsyncStorage,
): Promise<BudgetPlanCacheRecord | null> {
  const key = budgetPlanCacheKey(userId, householdId);
  const raw = await storage.getItem(key).catch(() => null);
  const parsed = parseBudgetPlanCache(raw, userId, householdId);
  if (!parsed && raw) await storage.removeItem(key).catch(() => undefined);
  return parsed;
}

export async function writeBudgetPlanCache(
  cache: BudgetPlanCacheRecord,
  storage: CacheStorage = AsyncStorage,
): Promise<boolean> {
  const raw = JSON.stringify(cache);
  if (raw.length > MAX_CACHE_BYTES) return false;
  try {
    await storage.setItem(
      budgetPlanCacheKey(cache.userId, cache.household.householdId),
      raw,
    );
    return true;
  } catch {
    return false;
  }
}

export async function clearBudgetPlanCachesForUser(
  userId: string,
  storage: CacheStorage = AsyncStorage,
) {
  const prefix = `${CACHE_PREFIX}:${cleanScopePart(userId)}:`;
  const keys = await storage.getAllKeys().catch(() => [] as readonly string[]);
  const matches = keys.filter(key => key.startsWith(prefix));
  if (matches.length > 0) await storage.multiRemove(matches).catch(() => undefined);
}

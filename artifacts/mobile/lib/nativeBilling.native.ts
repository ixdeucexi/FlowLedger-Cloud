import Purchases, {
  PURCHASES_ERROR_CODE,
  type PurchasesStoreProduct,
  type SubscriptionOption,
} from "react-native-purchases";
import { Linking, Platform } from "react-native";
import { supabase } from "@/lib/supabase";

import type { BillingProductId } from "@/lib/billing";
import {
  billingCadenceForProduct,
  verifiedBillingQuote,
  type BillingQuote,
  type StoreIntroFacts,
} from "@/lib/billingProductPolicy";
import { STORE_CHECKOUT_ENABLED } from "@/lib/launchMode";

export interface BillingStoreProduct {
  identifier: BillingProductId;
  priceString: string;
  quote: BillingQuote;
}
const preparedProducts = new WeakMap<
  BillingStoreProduct,
  {
    product: PurchasesStoreProduct;
    option: SubscriptionOption | null;
    userId: string;
  }
>();
import {
  billingIdentityAction,
  requireSupabaseBillingUserId,
} from "@/lib/billingIdentityPolicy";

let configured = false;
let enabledUserId: string | null = null;
let desiredUserId: string | null = null;
let identityGeneration = 0;
let identityQueue: Promise<void> = Promise.resolve();

function publicSdkKey(): string {
  const key =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : Platform.OS === "android"
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
        : null;
  const normalized = key?.trim();
  // RevenueCat intentionally terminates release builds configured with a Test
  // Store key. Test Store belongs only in Metro/debug builds; a standalone
  // Preview must stay usable while real App Store/Google Play keys are pending.
  if (!normalized || (!__DEV__ && normalized.startsWith("test_"))) {
    throw new Error("Store subscriptions are not configured in this build.");
  }
  return normalized;
}

export function isNativeBillingReady(): boolean {
  if (
    !STORE_CHECKOUT_ENABLED ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  )
    return false;
  try {
    publicSdkKey();
    return true;
  } catch {
    return false;
  }
}

function requireEnabledUser(): string {
  if (!enabledUserId)
    throw new Error("Sign in before managing a subscription.");
  return enabledUserId;
}

export async function activateBillingIdentity(userId: string): Promise<void> {
  const verifiedUserId = requireSupabaseBillingUserId(userId);
  if (!isNativeBillingReady()) return;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  desiredUserId = verifiedUserId;
  const generation = ++identityGeneration;
  const activation = identityQueue
    .catch(() => undefined)
    .then(async () => {
      await requireAuthenticatedUser(verifiedUserId);
      if (generation !== identityGeneration || desiredUserId !== verifiedUserId)
        return;
      const currentId = configured ? await Purchases.getAppUserID() : null;
      if (generation !== identityGeneration || desiredUserId !== verifiedUserId)
        return;
      const action = billingIdentityAction(
        configured,
        currentId,
        verifiedUserId,
      );
      if (action === "configure") {
        Purchases.configure({
          apiKey: publicSdkKey(),
          appUserID: verifiedUserId,
        });
        configured = true;
        await Purchases.setAllowSharingStoreAccount(false);
      } else if (action === "login") {
        await Purchases.logIn(verifiedUserId);
      }
      const verifiedId = await Purchases.getAppUserID();
      if (generation !== identityGeneration || desiredUserId !== verifiedUserId)
        return;
      if (verifiedId !== verifiedUserId)
        throw new Error(
          "The store purchaser identity does not match the signed-in account.",
        );
      await requireAuthenticatedUser(verifiedUserId);
      if (generation !== identityGeneration || desiredUserId !== verifiedUserId)
        return;
      enabledUserId = verifiedUserId;
    });
  identityQueue = activation;
  await activation;
}

export function deactivateBillingIdentity(): void {
  // Deliberately do not call Purchases.logOut(): it creates an anonymous ID.
  identityGeneration += 1;
  desiredUserId = null;
  enabledUserId = null;
}

export async function resetBillingIdentityAfterDeletion(): Promise<void> {
  deactivateBillingIdentity();
  if (!configured) return;
  // RevenueCat logOut() creates an anonymous App User ID. Keep the configured
  // SDK dormant instead; the next authenticated account is attached directly
  // with logIn(the Supabase UUID), and server checks reject every anonymous ID.
  Purchases.invalidateCustomerInfoCache();
}

async function requireAuthenticatedUser(expectedUserId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (
    error ||
    !data.session?.access_token ||
    data.session.user.id !== expectedUserId
  )
    throw new Error(
      "The signed-in account changed. Review your subscription again.",
    );
}

async function requireCurrentIdentity(expectedUserId: string): Promise<string> {
  const expected = requireSupabaseBillingUserId(expectedUserId);
  await requireAuthenticatedUser(expected);
  if (requireEnabledUser() !== expected || desiredUserId !== expected) {
    throw new Error(
      "The store purchaser identity changed. Sign in again before continuing.",
    );
  }
  const liveUserId = await Purchases.getAppUserID();
  if (
    liveUserId !== expected ||
    enabledUserId !== expected ||
    desiredUserId !== expected
  ) {
    throw new Error(
      "The store purchaser identity does not match the signed-in account.",
    );
  }
  await requireAuthenticatedUser(expected);
  return expected;
}

export async function loadBillingProduct(
  productId: BillingProductId,
): Promise<BillingStoreProduct> {
  const userId = requireEnabledUser();
  const products = await Purchases.getProducts([productId]);
  await requireCurrentIdentity(userId);
  const product = products.find(
    (candidate) => candidate.identifier === productId,
  );
  if (!product)
    throw new Error("That subscription is not available from this store yet.");
  let option: SubscriptionOption | null = null;
  let intro: StoreIntroFacts | undefined;
  let price = product.price,
    priceString = product.priceString,
    currencyCode = product.currencyCode;
  if (Platform.OS === "android") {
    // A base plan has no unknown/free phases. An approved eligible annual offer
    // may replace it, but the exact option is retained for purchase.
    option =
      product.subscriptionOptions?.find(
        (candidate) =>
          candidate.isBasePlan &&
          candidate.storeProductId === productId &&
          !candidate.isPrepaid &&
          !candidate.installmentsInfo,
      ) ?? null;
    const offered = product.defaultOption;
    if (
      offered &&
      !offered.isBasePlan &&
      offered.id.endsWith(":launch-first-year") &&
      offered.storeProductId === productId &&
      !offered.freePhase &&
      !offered.isPrepaid &&
      !offered.installmentsInfo &&
      offered.pricingPhases.length === 2 &&
      offered.introPhase?.billingPeriod.iso8601 === "P1Y" &&
      offered.introPhase.billingCycleCount === 1 &&
      billingCadenceForProduct(productId) === "annual"
    ) {
      const first = offered.introPhase.price;
      const full = offered.fullPricePhase?.price;
      if (
        full &&
        first.currencyCode === full.currencyCode &&
        (full.currencyCode !== "USD" || first.amountMicros === 59_990_000)
      ) {
        option = offered;
        intro = {
          price: first.amountMicros / 1_000_000,
          priceString: first.formatted,
          period: "P1Y",
          cycles: 1,
          eligible: true,
        };
      }
    }
    if (
      !option?.fullPricePhase ||
      option.freePhase ||
      option.isPrepaid ||
      option.installmentsInfo ||
      (option.isBasePlan && option.pricingPhases.length !== 1)
    )
      throw new Error(
        "The store base plan is not ready. No purchase was started.",
      );
    price = option.fullPricePhase.price.amountMicros / 1_000_000;
    priceString = option.fullPricePhase.price.formatted;
    currencyCode = option.fullPricePhase.price.currencyCode;
  } else if (product.introPrice) {
    const eligibility =
      await Purchases.checkTrialOrIntroductoryPriceEligibility([productId]);
    await requireCurrentIdentity(userId);
    const status = eligibility[productId]?.status;
    if (
      status ===
      Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN
    )
      throw new Error(
        "Your introductory offer eligibility could not be verified. Try again later.",
      );
    if (
      status ===
      Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
    ) {
      const offered = product.introPrice;
      intro = {
        price: offered.price,
        priceString: offered.priceString,
        period: offered.period,
        cycles: offered.cycles,
        eligible: true,
      };
    }
  }
  const quote = verifiedBillingQuote(
    {
      identifier: product.identifier,
      subscription:
        product.productCategory === Purchases.PRODUCT_CATEGORY.SUBSCRIPTION,
      subscriptionPeriod:
        option?.billingPeriod?.iso8601 ?? product.subscriptionPeriod,
      price,
      priceString,
      currencyCode,
    },
    productId,
    intro,
  );
  if (intro && !quote.introductory)
    throw new Error(
      "The store introductory terms do not match this launch offer. No purchase was started.",
    );
  const prepared: BillingStoreProduct = {
    identifier: productId,
    priceString: quote.priceString,
    quote,
  };
  preparedProducts.set(prepared, { product, option, userId });
  return prepared;
}

export async function purchaseBillingProduct(
  product: BillingStoreProduct,
  attributes: {
    intentId: string;
    householdId: string;
    expectedUserId: string;
    isCurrent?: () => boolean;
  },
): Promise<void> {
  const current = () => {
    if (attributes.isCurrent && !attributes.isCurrent())
      throw new Error(
        "The selected household changed. Review the subscription again.",
      );
  };
  current();
  await requireCurrentIdentity(attributes.expectedUserId);
  current();
  const prepared = preparedProducts.get(product);
  if (!prepared || prepared.userId !== attributes.expectedUserId)
    throw new Error("Load the current store offer again before purchasing.");
  await Purchases.setAttributes({
    flowledger_intent_id: attributes.intentId,
    flowledger_household_id: attributes.householdId,
  });
  current();
  await requireCurrentIdentity(attributes.expectedUserId);
  current();
  if (prepared.option)
    await Purchases.purchaseSubscriptionOption(prepared.option);
  else await Purchases.purchaseStoreProduct(prepared.product);
}

export async function restoreBillingPurchases(attributes: {
  intentId: string;
  householdId: string;
  expectedUserId: string;
  isCurrent?: () => boolean;
}): Promise<void> {
  if (attributes.isCurrent && !attributes.isCurrent())
    throw new Error("The selected household changed.");
  await requireCurrentIdentity(attributes.expectedUserId);
  await Purchases.setAttributes({
    flowledger_intent_id: attributes.intentId,
    flowledger_household_id: attributes.householdId,
  });
  await requireCurrentIdentity(attributes.expectedUserId);
  if (attributes.isCurrent && !attributes.isCurrent())
    throw new Error("The selected household changed.");
  await Purchases.restorePurchases();
}

export async function openBillingManagement(
  expectedUserId: string,
): Promise<void> {
  await requireCurrentIdentity(expectedUserId);
  await Purchases.showManageSubscriptions();
}

export async function openStoreSubscriptionSettings(): Promise<void> {
  const url =
    Platform.OS === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";
  await Linking.openURL(url);
}

export function isBillingCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { userCancelled?: unknown; code?: unknown };
  return (
    candidate.userCancelled === true ||
    candidate.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

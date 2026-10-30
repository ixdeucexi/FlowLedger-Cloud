import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import {
  billingProductId,
  billingStatusMessage,
  cancelBillingIntents,
  createBillingIntent,
  createBillingRestoreIntent,
  markBillingIntentPurchasing,
  readBillingStatus,
  reconcileBillingRestore,
  waitForServerBillingStatus,
  type BillingEntitlementStatus,
} from "@/lib/billing";
import { PLAN_CATALOG, PLAN_TIERS, type PlanTier } from "@/lib/membership";
import { billingQuoteDisclosure } from "@/lib/billingProductPolicy";
import {
  STORE_CHECKOUT_ENABLED,
  FOUNDING_FREE_NAME,
  hasAdminProAccess,
} from "@/lib/launchMode";
import { isCompactMembershipLayout } from "@/lib/membershipLayout";
import {
  activateBillingIdentity,
  isNativeBillingReady,
  isBillingCancellation,
  loadBillingProduct,
  openBillingManagement,
  openStoreSubscriptionSettings,
  purchaseBillingProduct,
  restoreBillingPurchases,
  type BillingStoreProduct,
} from "@/lib/nativeBilling";

function confirmBilling(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export function MembershipPanel() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactMembershipLayout(viewportWidth);
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const {
    actualPlan,
    previewTier,
    loading,
    accessReady,
    accessError,
    hasFoundingAccess,
    floAllowance,
    refreshPlan,
    refreshAccess,
  } = useMembership();
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">(
    "annual",
  );
  const [billingBusy, setBillingBusy] = useState<
    "purchase" | "restore" | "manage" | null
  >(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [entitlement, setEntitlement] =
    useState<BillingEntitlementStatus | null>(null);
  const [storeProducts, setStoreProducts] = useState<
    Partial<Record<"monthly" | "annual", BillingStoreProduct>>
  >({});
  const [productsLoading, setProductsLoading] = useState(false);
  const [productRetry, setProductRetry] = useState(0);
  const nativeStore = Platform.OS === "ios" || Platform.OS === "android";
  const nativeReady =
    STORE_CHECKOUT_ENABLED && nativeStore && isNativeBillingReady();
  const owner = Boolean(
    user?.id && activeHousehold?.role === "owner" && !demoMode,
  );
  const canManageBilling = nativeReady && owner && accessReady && !previewTier;
  const scopeKey = `${user?.id ?? "signed-out"}:${activeHousehold?.householdId ?? "none"}:${activeHousehold?.role ?? "none"}:${demoMode ? "demo" : "real"}`;
  const liveScope = useRef({ key: scopeKey, mounted: true, generation: 0 });
  if (liveScope.current.key !== scopeKey)
    liveScope.current = {
      key: scopeKey,
      mounted: true,
      generation: liveScope.current.generation + 1,
    };
  useEffect(() => {
    liveScope.current.mounted = true;
    return () => {
      liveScope.current.mounted = false;
      liveScope.current.generation += 1;
    };
  }, []);
  const renderGeneration = liveScope.current.generation;
  const currentScope = () => {
    const generation = renderGeneration;
    return () =>
      liveScope.current.mounted &&
      liveScope.current.key === scopeKey &&
      liveScope.current.generation === generation;
  };
  useEffect(() => {
    setBillingBusy(null);
    setBillingMessage(null);
    setStoreProducts({});
    setEntitlement(null);
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    const current = currentScope();
    if (!canManageBilling || !activeHousehold?.householdId) return;
    void readBillingStatus(activeHousehold.householdId)
      .then((status) => {
        if (!cancelled && current()) setEntitlement(status.entitlement);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scopeKey, canManageBilling]);

  useEffect(() => {
    let cancelled = false;
    const current = currentScope();
    setStoreProducts({});
    if (!canManageBilling || !user?.id) {
      setProductsLoading(false);
      return;
    }
    setProductsLoading(true);
    void (async () => {
      try {
        await activateBillingIdentity(user.id);
        if (cancelled || !current()) return;
        const products = await Promise.allSettled([
          loadBillingProduct(billingProductId("monthly")),
          loadBillingProduct(billingProductId("annual")),
        ]);
        if (cancelled || !current()) return;
        setStoreProducts({
          monthly:
            products[0].status === "fulfilled" ? products[0].value : undefined,
          annual:
            products[1].status === "fulfilled" ? products[1].value : undefined,
        });
        if (products.some((result) => result.status === "rejected"))
          setBillingMessage(
            "Some store products are not ready yet. Only verified available prices can be purchased.",
          );
      } catch (error) {
        if (!cancelled && current())
          setBillingMessage(
            error instanceof Error
              ? error.message
              : "Store products could not be verified.",
          );
      } finally {
        if (!cancelled && current()) setProductsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeKey, canManageBilling, productRetry]);

  const purchasePro = async () => {
    if (
      !activeHousehold ||
      !user?.id ||
      !canManageBilling ||
      !storeProducts[billingCadence] ||
      billingBusy
    )
      return;
    const current = currentScope();
    const household = { ...activeHousehold },
      actorId = user.id;
    if (!current()) return;
    setBillingMessage(null);
    setBillingBusy("purchase");
    let intentId: string | null = null,
      storePurchaseCompleted = false;
    try {
      const productId = billingProductId(billingCadence);
      const product = await loadBillingProduct(productId);
      if (!current()) return;
      const confirmed = await confirmBilling(
        `Apply Pro to ${household.name}?`,
        `${billingQuoteDisclosure(product.quote)} Billed by ${Platform.OS === "ios" ? "Apple" : "Google"}. This subscription covers the members of ${household.name}.`,
        "Continue to store",
      );
      if (!confirmed || !current()) return;
      const intent = await createBillingIntent({
        householdId: household.householdId,
        householdName: household.name,
        productId,
      });
      intentId = intent.intentId;
      if (!current()) return;
      if (
        intent.appUserId !== actorId ||
        intent.householdId !== household.householdId ||
        intent.productId !== productId
      )
        throw new Error(
          "The subscription account changed. Review your household before continuing.",
        );
      await markBillingIntentPurchasing(household.householdId, intent.intentId);
      if (!current()) return;
      await purchaseBillingProduct(product, {
        intentId: intent.intentId,
        householdId: household.householdId,
        expectedUserId: actorId,
        isCurrent: current,
      });
      storePurchaseCompleted = true;
      if (!current()) return;
      setBillingMessage(
        "Your store confirmed the purchase. FlowLedger is verifying it for this household…",
      );
      const status = await waitForServerBillingStatus(household.householdId);
      if (!current()) return;
      setEntitlement(status.entitlement);
      await refreshPlan();
      if (current())
        setBillingMessage(
          status.plan.tier === "pro"
            ? `Pro is active for ${household.name}.`
            : "Your store confirmed the purchase. Server verification is still pending; your plan will update when it is verified.",
        );
    } catch (error) {
      if (intentId && !storePurchaseCompleted && isBillingCancellation(error))
        await cancelBillingIntents(household.householdId, [intentId]).catch(
          () => undefined,
        );
      if (current() && !isBillingCancellation(error))
        setBillingMessage(
          error instanceof Error
            ? error.message
            : "The purchase could not be completed.",
        );
    } finally {
      if (current()) setBillingBusy(null);
    }
  };

  const restorePro = async () => {
    if (!activeHousehold || !user?.id || !canManageBilling || billingBusy)
      return;
    const current = currentScope(),
      household = { ...activeHousehold },
      actorId = user.id;
    if (!current()) return;
    const confirmed = await confirmBilling(
      `Restore Pro to ${household.name}?`,
      `Restore purchases belonging to this FlowLedger account to ${household.name}. A purchase tied to another account cannot be moved here.`,
      "Restore",
    );
    if (!confirmed || !current()) return;
    setBillingMessage(null);
    setBillingBusy("restore");
    let restoreIntentIds: string[] = [],
      storeRestoreCompleted = false;
    try {
      const intent = await createBillingRestoreIntent({
        householdId: household.householdId,
        householdName: household.name,
      });
      restoreIntentIds = intent.intents.map((item) => item.id);
      if (!current()) return;
      if (
        intent.appUserId !== actorId ||
        intent.householdId !== household.householdId
      )
        throw new Error(
          "The subscription account changed. Restore again after checking your household.",
        );
      await restoreBillingPurchases({
        intentId: restoreIntentIds[0] ?? "",
        householdId: household.householdId,
        expectedUserId: actorId,
        isCurrent: current,
      });
      storeRestoreCompleted = true;
      if (!current()) return;
      await reconcileBillingRestore(household.householdId, restoreIntentIds);
      if (!current()) return;
      const status = await waitForServerBillingStatus(household.householdId);
      if (!current()) return;
      setEntitlement(status.entitlement);
      await refreshPlan();
      if (current())
        setBillingMessage(
          status.plan.tier === "pro"
            ? `Pro was restored for ${household.name}.`
            : "No verified active Pro purchase for this account was found yet.",
        );
    } catch (error) {
      if (
        restoreIntentIds.length &&
        !storeRestoreCompleted &&
        isBillingCancellation(error)
      )
        await cancelBillingIntents(
          household.householdId,
          restoreIntentIds,
        ).catch(() => undefined);
      if (current() && !isBillingCancellation(error))
        setBillingMessage(
          error instanceof Error
            ? error.message
            : "Purchases could not be restored.",
        );
    } finally {
      if (current()) setBillingBusy(null);
    }
  };
  const managePro = async () => {
    if (!user?.id || !owner || actualPlan.source !== "billing" || billingBusy)
      return;
    const current = currentScope();
    if (!current()) return;
    setBillingBusy("manage");
    setBillingMessage(null);
    try {
      if (nativeReady) await openBillingManagement(user.id);
      else await openStoreSubscriptionSettings();
    } catch (error) {
      if (current())
        setBillingMessage(
          error instanceof Error
            ? error.message
            : "Open subscription settings in your store.",
        );
    } finally {
      if (current()) setBillingBusy(null);
    }
  };
  const lifecycleMessage = billingStatusMessage(entitlement);

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.currentCard,
          compactLayout && styles.currentCardCompact,
          { backgroundColor: colors.card, borderColor: colors.primary + "55" },
        ]}
      >
        <View
          style={[styles.planIcon, { backgroundColor: colors.primary + "18" }]}
        >
          <Feather
            name={hasFoundingAccess ? "gift" : "award"}
            size={22}
            color={colors.primary}
          />
        </View>
        <View style={styles.currentCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            CURRENT HOUSEHOLD PLAN
          </Text>
          <Text style={[styles.currentTitle, { color: colors.foreground }]}>
            {loading
              ? "Loading…"
              : hasFoundingAccess && actualPlan.tier === "free"
                ? FOUNDING_FREE_NAME
                : PLAN_CATALOG[actualPlan.tier].name}
          </Text>
          <Text
            style={[
              styles.currentDescription,
              { color: colors.mutedForeground },
            ]}
          >
            {actualPlan.source === "grandfathered"
              ? "Permanent grandfathered Pro access · no expiration"
              : hasAdminProAccess(actualPlan)
                ? "ADMIN HOUSEHOLD PLAN · Pro granted by a FlowLedger admin"
                : hasFoundingAccess
                  ? "Your existing planning and Flo tools are protected. No subscription required for those tools."
                  : "One plan covers the members of this household."}
          </Text>
        </View>
      </View>
      {previewTier ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.billingNote, { color: colors.warning }]}
        >
          Admin preview: {PLAN_CATALOG[previewTier].name}. Your actual household
          plan is unchanged; purchases are disabled during preview.
        </Text>
      ) : null}
      {accessError ? (
        <View
          style={[
            styles.earlyAccess,
            {
              backgroundColor: colors.warning + "10",
              borderColor: colors.warning + "40",
            },
          ]}
        >
          <View style={styles.currentCopy}>
            <Text
              accessibilityRole="alert"
              style={{ color: colors.foreground }}
            >
              {accessError}
            </Text>
            <Text
              style={[
                styles.currentDescription,
                { color: colors.mutedForeground },
              ]}
            >
              Free everyday planning stays available.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry household plan access"
            onPress={() => void refreshAccess()}
            style={styles.secondaryButton}
          >
            <Text style={{ color: colors.primary }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {floAllowance ? (
        <View
          style={[
            styles.earlyAccess,
            {
              backgroundColor: colors.success + "10",
              borderColor: colors.success + "35",
            },
          ]}
        >
          <Feather name="message-circle" size={17} color={colors.success} />
          <View style={styles.currentCopy}>
            <Text
              style={[styles.earlyAccessText, { color: colors.foreground }]}
            >
              {floAllowance.period === "day"
                ? "Your existing daily Flo allowance is preserved."
                : `${floAllowance.remaining} of ${floAllowance.limit} Flo requests left this month.`}
            </Text>
            <Text
              style={[
                styles.currentDescription,
                { color: colors.mutedForeground },
              ]}
            >
              Unlimited local Flo Essentials remains available.{" "}
              {floAllowance.period === "month"
                ? `Resets ${new Date(floAllowance.resetsAt).toLocaleDateString()}.`
                : "Daily safety limits still apply."}
            </Text>
          </View>
        </View>
      ) : null}
      <View
        style={[
          styles.cadence,
          compactLayout && styles.cadenceCompact,
          { backgroundColor: colors.muted, borderColor: colors.border },
        ]}
      >
        {(["monthly", "annual"] as const).map((cadence) => {
          const selected = billingCadence === cadence;
          return (
            <Pressable
              key={cadence}
              accessibilityRole="button"
              accessibilityLabel={`Show ${cadence} pricing`}
              accessibilityState={{ selected }}
              onPress={() => setBillingCadence(cadence)}
              style={[
                styles.cadenceButton,
                compactLayout && styles.cadenceButtonCompact,
                { backgroundColor: selected ? colors.card : "transparent" },
              ]}
            >
              <Text
                style={[
                  styles.cadenceText,
                  {
                    color: selected
                      ? colors.foreground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {cadence === "annual" ? "Yearly" : "Monthly"}
                {selected ? " · Selected" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {PLAN_TIERS.map((tier: PlanTier) => {
        const plan = PLAN_CATALOG[tier],
          isCurrent = actualPlan.tier === tier,
          isPreview = previewTier === tier;
        const product =
          tier === "pro" ? storeProducts[billingCadence] : undefined;
        const price =
          billingCadence === "annual" ? plan.annualPrice : plan.monthlyPrice;
        return (
          <View
            key={tier}
            style={[
              styles.planCard,
              compactLayout && styles.planCardCompact,
              {
                backgroundColor: colors.card,
                borderColor: isPreview
                  ? colors.warning
                  : tier === "pro"
                    ? colors.primary + "66"
                    : colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.planHeader,
                compactLayout && styles.planHeaderCompact,
              ]}
            >
              <View style={styles.currentCopy}>
                <View style={styles.planNameRow}>
                  <Text style={[styles.planName, { color: colors.foreground }]}>
                    {plan.name}
                  </Text>
                  {isCurrent ? (
                    <View
                      style={[
                        styles.bestBadge,
                        { backgroundColor: colors.success + "18" },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bestBadgeText,
                          { color: colors.success },
                        ]}
                      >
                        CURRENT
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.promise, { color: colors.primary }]}>
                  {plan.promise}
                </Text>
              </View>
              <View
                style={[
                  styles.priceWrap,
                  compactLayout && styles.priceWrapCompact,
                ]}
              >
                <Text style={[styles.price, { color: colors.foreground }]}>
                  {price === 0
                    ? "$0"
                    : (product?.quote.priceString ??
                      `$${price.toFixed(2)} USD`)}
                </Text>
                <Text
                  style={[
                    styles.priceCadence,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {price === 0
                    ? "always free"
                    : billingCadence === "annual"
                      ? "/year per household"
                      : "/month per household"}
                </Text>
              </View>
            </View>
            {product?.quote.introductory ? (
              <Text style={[styles.savings, { color: colors.success }]}>
                {product.quote.introductory.priceString} for the first year,
                then {product.quote.priceString}/year. Store-verified eligible
                offer.
              </Text>
            ) : null}
            <Text
              style={[
                styles.planDescription,
                { color: colors.mutedForeground },
              ]}
            >
              {plan.description}
            </Text>
            <View style={styles.highlightList}>
              {plan.highlights.map((highlight) => (
                <View key={highlight} style={styles.highlightRow}>
                  <Feather name="check" size={15} color={colors.success} />
                  <Text
                    style={[styles.highlightText, { color: colors.foreground }]}
                  >
                    {highlight}
                  </Text>
                </View>
              ))}
            </View>
            {tier === "pro" && !isCurrent && canManageBilling && product ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Subscribe to Pro for ${activeHousehold?.name ?? "the active household"}`}
                disabled={billingBusy !== null}
                onPress={() => void purchasePro()}
                style={({ pressed }) => [
                  styles.planButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || billingBusy ? 0.72 : 1,
                  },
                ]}
              >
                {billingBusy === "purchase" ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.planButtonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Continue with store
                  </Text>
                )}
              </Pressable>
            ) : (
              <View
                style={[
                  styles.planButton,
                  {
                    backgroundColor: isCurrent
                      ? colors.success + "18"
                      : colors.muted,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.planButtonText,
                    {
                      color: isCurrent
                        ? colors.success
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {isCurrent
                    ? hasFoundingAccess && tier === "free"
                      ? "Free plan · founding tools retained"
                      : "Current plan"
                    : productsLoading
                      ? "Checking store products…"
                      : !nativeReady
                        ? "Pro subscriptions are not open yet"
                        : !owner
                          ? "Household owner required"
                          : previewTier
                            ? "Purchases disabled in preview"
                            : "Store product unavailable"}
                </Text>
              </View>
            )}
          </View>
        );
      })}
      <View
        style={[
          styles.earlyAccess,
          {
            backgroundColor: colors.primary + "10",
            borderColor: colors.primary + "35",
          },
        ]}
      >
        <Feather name="clock" size={17} color={colors.primary} />
        <Text style={[styles.earlyAccessText, { color: colors.foreground }]}>
          Bank sync and automatic bank matching are planned for Pro after public
          approval. Manual accounts, statement imports and review of existing
          entries remain available.
        </Text>
      </View>
      {lifecycleMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.billingNote, { color: colors.warning }]}
        >
          {lifecycleMessage}
        </Text>
      ) : null}
      {billingMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.billingNote, { color: colors.foreground }]}
        >
          {billingMessage}
        </Text>
      ) : null}
      {canManageBilling ? (
        <View style={styles.billingActions}>
          <Pressable
            accessibilityRole="button"
            disabled={billingBusy !== null}
            onPress={() => void restorePro()}
            style={[styles.secondaryButton, { borderColor: colors.border }]}
          >
            {billingBusy === "restore" ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text
                style={[styles.secondaryButtonText, { color: colors.primary }]}
              >
                Restore purchase
              </Text>
            )}
          </Pressable>
          {!productsLoading ? (
            <Pressable
              accessibilityRole="button"
              disabled={billingBusy !== null}
              onPress={() => setProductRetry((value) => value + 1)}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Text
                style={[styles.secondaryButtonText, { color: colors.primary }]}
              >
                Retry store products
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {nativeStore && owner && actualPlan.source === "billing" ? (
        <Pressable
          accessibilityRole="button"
          disabled={billingBusy !== null}
          onPress={() => void managePro()}
          style={[styles.secondaryButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
            Manage subscription
          </Text>
        </Pressable>
      ) : null}
      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        {nativeReady
          ? "Your store shows the exact localized price and any eligible offer before purchase. Payment is charged to your Apple App Store or Google Play account. Subscriptions renew automatically until cancelled. No free trial."
          : "US plan prices are shown for comparison. Paid checkout opens only after the store products and prices are verified. No purchase is available from this screen yet."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  currentCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  currentCardCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    padding: 12,
  },
  planIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  currentCopy: { flex: 1 },
  eyebrow: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
  },
  currentTitle: {
    fontSize: 23,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  currentDescription: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
  },
  earlyAccess: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  earlyAccessText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },
  cadence: {
    alignSelf: "center",
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
  },
  cadenceCompact: { alignSelf: "stretch" },
  cadenceButton: {
    minWidth: 112,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cadenceButtonCompact: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  cadenceText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  planCard: { borderWidth: 1, borderRadius: 20, padding: 17 },
  planCardCompact: { padding: 12 },
  planHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  planHeaderCompact: { flexDirection: "column", gap: 6 },
  planNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  planName: { fontSize: 23, fontFamily: "Inter_800ExtraBold" },
  bestBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  bestBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.5,
  },
  promise: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  priceWrap: { alignItems: "flex-end" },
  priceWrapCompact: { alignItems: "flex-start" },
  price: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  priceCadence: { fontSize: 10, fontFamily: "Inter_500Medium" },
  savings: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textAlign: "right",
    marginTop: 4,
  },
  savingsCompact: { textAlign: "left" },
  planDescription: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginTop: 12,
  },
  highlightList: { gap: 8, marginTop: 13 },
  highlightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  highlightText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  planButton: {
    minHeight: 48,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 15,
  },
  planButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  billingActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  secondaryButton: {
    minHeight: 44,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  billingNote: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_600SemiBold",
  },
  disclosure: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular" },
});

import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

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
import { FOUNDING_FREE_LAUNCH, FOUNDING_FREE_NAME, PRO_AVAILABILITY, hasAdminProAccess } from "@/lib/launchMode";
import { isCompactMembershipLayout } from "@/lib/membershipLayout";
import {
  isBillingCancellation,
  loadBillingProduct,
  openBillingManagement,
  purchaseBillingProduct,
  restoreBillingPurchases,
} from "@/lib/nativeBilling";

function confirmBilling(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise(resolve => Alert.alert(title, message, [
    { text: "Not now", style: "cancel", onPress: () => resolve(false) },
    { text: confirmLabel, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function MembershipPanel() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactMembershipLayout(viewportWidth);
  const { user, demoMode } = useAuth();
  const { activeHousehold } = useBudget();
  const { actualPlan, previewTier, loading, refreshPlan } = useMembership();
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">("annual");
  const [billingBusy, setBillingBusy] = useState<"purchase" | "restore" | "manage" | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<BillingEntitlementStatus | null>(null);
  const [storePrices, setStorePrices] = useState<Partial<Record<"monthly" | "annual", string>>>({});
  const nativeStore = Platform.OS === "ios" || Platform.OS === "android";
  const adminProAccess = hasAdminProAccess(actualPlan);
  const canManageBilling = !FOUNDING_FREE_LAUNCH && nativeStore && Boolean(user?.id && activeHousehold?.role === "owner" && !demoMode);

  useEffect(() => {
    let cancelled = false;
    setEntitlement(null);
    if (FOUNDING_FREE_LAUNCH || !user?.id || !activeHousehold?.householdId || demoMode) return () => { cancelled = true; };
    void readBillingStatus(activeHousehold.householdId).then(status => {
      if (!cancelled) setEntitlement(status.entitlement);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeHousehold?.householdId, demoMode, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!canManageBilling) { setStorePrices({}); return () => { cancelled = true; }; }
    void Promise.allSettled([
      loadBillingProduct(billingProductId("monthly")),
      loadBillingProduct(billingProductId("annual")),
    ]).then(results => {
      if (cancelled) return;
      setStorePrices({
        monthly: results[0].status === "fulfilled" ? results[0].value.priceString : undefined,
        annual: results[1].status === "fulfilled" ? results[1].value.priceString : undefined,
      });
    });
    return () => { cancelled = true; };
  }, [canManageBilling]);

  const purchasePro = async () => {
    if (!activeHousehold || !canManageBilling) return;
    setBillingMessage(null);
    setBillingBusy("purchase");
    let intentId: string | null = null;
    let storePurchaseCompleted = false;
    try {
      const productId = billingProductId(billingCadence);
      const product = await loadBillingProduct(productId);
      const price = `${product.priceString} per ${billingCadence === "annual" ? "year" : "month"}`;
      const confirmed = await confirmBilling(
        `Apply Pro to ${activeHousehold.name}?`,
        `${price}, billed by ${Platform.OS === "ios" ? "Apple" : "Google"}. There is no free trial. It renews automatically until cancelled in your store account. This purchase applies only to the currently active household: ${activeHousehold.name}.`,
        "Continue to store",
      );
      if (!confirmed) return;
      const intent = await createBillingIntent({ householdId: activeHousehold.householdId, householdName: activeHousehold.name, productId });
      intentId = intent.intentId;
      await markBillingIntentPurchasing(activeHousehold.householdId, intent.intentId);
      await purchaseBillingProduct(product, { intentId: intent.intentId, householdId: activeHousehold.householdId, expectedUserId: user!.id });
      storePurchaseCompleted = true;
      setBillingMessage("The store confirmed your purchase. FlowLedger is verifying it for this household…");
      const status = await waitForServerBillingStatus(activeHousehold.householdId);
      setEntitlement(status.entitlement);
      await refreshPlan();
      setBillingMessage(status.plan.tier === "pro"
        ? `Pro is active for ${activeHousehold.name}.`
        : "The store confirmed the purchase, but server verification is still pending. Your plan will update after the store webhook arrives.");
    } catch (error) {
      if (intentId && !storePurchaseCompleted && isBillingCancellation(error)) {
        await cancelBillingIntents(activeHousehold.householdId, [intentId]).catch(() => undefined);
      }
      if (!isBillingCancellation(error)) setBillingMessage(error instanceof Error ? error.message : "The purchase could not be completed.");
    } finally {
      setBillingBusy(null);
    }
  };

  const restorePro = async () => {
    if (!activeHousehold || !canManageBilling) return;
    const confirmed = await confirmBilling(
      `Restore Pro to ${activeHousehold.name}?`,
      `FlowLedger will ask ${Platform.OS === "ios" ? "Apple" : "Google"} for purchases belonging to this signed-in account. A purchase tied to another FlowLedger account cannot be moved to this household.`,
      "Restore",
    );
    if (!confirmed) return;
    setBillingMessage(null);
    setBillingBusy("restore");
    let restoreIntentIds: string[] = [];
    let storeRestoreCompleted = false;
    try {
      const restoreIntent = await createBillingRestoreIntent({ householdId: activeHousehold.householdId, householdName: activeHousehold.name });
      restoreIntentIds = restoreIntent.intents.map(intent => intent.id);
      await restoreBillingPurchases({ intentId: restoreIntent.intents[0]?.id ?? "", householdId: activeHousehold.householdId, expectedUserId: user!.id });
      storeRestoreCompleted = true;
      await reconcileBillingRestore(activeHousehold.householdId, restoreIntent.intents.map(intent => intent.id));
      const status = await waitForServerBillingStatus(activeHousehold.householdId);
      setEntitlement(status.entitlement);
      await refreshPlan();
      setBillingMessage(status.plan.tier === "pro"
        ? `Pro was restored for ${activeHousehold.name}.`
        : "No verified Pro purchase for this FlowLedger account was found yet.");
    } catch (error) {
      if (restoreIntentIds.length && !storeRestoreCompleted && isBillingCancellation(error)) {
        await cancelBillingIntents(activeHousehold.householdId, restoreIntentIds).catch(() => undefined);
      }
      if (!isBillingCancellation(error)) setBillingMessage(error instanceof Error ? error.message : "Purchases could not be restored.");
    } finally {
      setBillingBusy(null);
    }
  };

  const managePro = async () => {
    setBillingBusy("manage");
    setBillingMessage(null);
    try { await openBillingManagement(user!.id); } catch (error) {
      setBillingMessage(error instanceof Error ? error.message : "Your store subscription settings could not be opened.");
    } finally { setBillingBusy(null); }
  };

  const lifecycleMessage = billingStatusMessage(entitlement);

  if (FOUNDING_FREE_LAUNCH && adminProAccess) {
    return (
      <View style={styles.root}>
        <View style={[styles.currentCard, { backgroundColor: colors.card, borderColor: colors.primary + "66" }]}>
          <View style={[styles.planIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="award" size={22} color={colors.primary} />
          </View>
          <View style={styles.currentCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>ADMIN HOUSEHOLD PLAN</Text>
            <Text style={[styles.currentTitle, { color: colors.foreground }]}>FlowLedger Pro</Text>
            <Text style={[styles.currentDescription, { color: colors.mutedForeground }]}>Pro granted by a FlowLedger admin · no store subscription required</Text>
          </View>
        </View>
        <View style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
          <Text style={[styles.planName, { color: colors.foreground }]}>Your Pro tools are active</Text>
          <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>Secure bank connections, Plaid sync, account-aware Flo, and every Founding Free planning tool remain available for this household.</Text>
          <View style={styles.highlightList}>
            {["Plaid bank connections and sync", "Account-aware Flo guidance", "Daily Forecast and debt Snowball", "Reports, Review Center, and spending buckets"].map(highlight => (
              <View key={highlight} style={styles.highlightRow}>
                <Feather name="check" size={15} color={colors.success} />
                <Text style={[styles.highlightText, { color: colors.foreground }]}>{highlight}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[styles.earlyAccess, { backgroundColor: colors.success + "10", borderColor: colors.success + "35" }]}>
          <Feather name="shield" size={17} color={colors.success} />
          <Text style={[styles.earlyAccessText, { color: colors.foreground }]}>Public accounts remain on {FOUNDING_FREE_NAME}; this admin grant is account-scoped and does not expose purchase controls.</Text>
        </View>
      </View>
    );
  }

  if (FOUNDING_FREE_LAUNCH) {
    return (
      <View style={styles.root}>
        <View style={[styles.currentCard, { backgroundColor: colors.card, borderColor: colors.success + "55" }]}>
          <View style={[styles.planIcon, { backgroundColor: colors.success + "18" }]}>
            <Feather name="gift" size={22} color={colors.success} />
          </View>
          <View style={styles.currentCopy}>
            <Text style={[styles.eyebrow, { color: colors.success }]}>PUBLIC LAUNCH PLAN</Text>
            <Text style={[styles.currentTitle, { color: colors.foreground }]}>{FOUNDING_FREE_NAME}</Text>
            <Text style={[styles.currentDescription, { color: colors.mutedForeground }]}>No subscription or trial required.</Text>
          </View>
        </View>
        <View style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
          <Text style={[styles.planName, { color: colors.foreground }]}>Plan clearly. Pay nothing.</Text>
          <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>Forecast, bills, debt payoff, spending buckets, reports, and Flo are available during the Founding Free launch.</Text>
          <View style={styles.highlightList}>
            {["Daily cash forecast", "Debt Snowball planner", "Bills, activity, and spending buckets", "Flo guidance grounded in your plan"].map(highlight => (
              <View key={highlight} style={styles.highlightRow}>
                <Feather name="check" size={15} color={colors.success} />
                <Text style={[styles.highlightText, { color: colors.foreground }]}>{highlight}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[styles.earlyAccess, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "35" }]}>
          <Feather name="clock" size={17} color={colors.primary} />
          <Text style={[styles.earlyAccessText, { color: colors.foreground }]}>{PRO_AVAILABILITY}. Bank sync and advanced automation will arrive only after they are ready.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.currentCard,
          compactLayout && styles.currentCardCompact,
          { backgroundColor: colors.card, borderColor: colors.primary + "55" },
        ]}
      >
        <View style={[styles.planIcon, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="award" size={22} color={colors.primary} />
        </View>
        <View style={styles.currentCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>CURRENT HOUSEHOLD PLAN</Text>
          <Text style={[styles.currentTitle, { color: colors.foreground }]}>
            {loading ? "Loading…" : PLAN_CATALOG[actualPlan.tier].name}
          </Text>
          <Text style={[styles.currentDescription, { color: colors.mutedForeground }]}>
            {actualPlan.source === "grandfathered"
              ? "Grandfathered Pro access · no expiration"
              : actualPlan.source === "admin"
                ? "Pro granted by a FlowLedger admin"
                : "Your household's live plan"}
          </Text>
        </View>
      </View>

      <View style={[styles.earlyAccess, { backgroundColor: colors.success + "10", borderColor: colors.success + "35" }]}>
        <Feather name="check-circle" size={17} color={colors.success} />
        <Text style={[styles.earlyAccessText, { color: colors.foreground }]}>
          Basic includes manual planning. Pro adds bank connections and account-aware Flo.
        </Text>
      </View>

      <View style={[styles.cadence, compactLayout && styles.cadenceCompact, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        {(["monthly", "annual"] as const).map(cadence => {
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
              <Text style={[styles.cadenceText, { color: selected ? colors.foreground : colors.mutedForeground }]}>
                {cadence === "annual" ? "Annual · save" : "Monthly"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {PLAN_TIERS.map((tier: PlanTier) => {
        const plan = PLAN_CATALOG[tier];
        const isCurrent = actualPlan.tier === tier;
        const isPreview = previewTier === tier;
        const price = billingCadence === "annual" ? plan.annualPrice : plan.monthlyPrice;
        const localizedProPrice = tier === "pro" ? storePrices[billingCadence] : null;
        return (
          <View
            key={tier}
            style={[
              styles.planCard,
              compactLayout && styles.planCardCompact,
              {
                backgroundColor: colors.card,
                borderColor: isPreview ? colors.warning : tier === "pro" ? colors.primary + "66" : colors.border,
              },
            ]}
          >
            <View style={[styles.planHeader, compactLayout && styles.planHeaderCompact]}>
              <View style={styles.currentCopy}>
                <View style={styles.planNameRow}>
                  <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
                  {tier === "pro" ? (
                    <View style={[styles.bestBadge, { backgroundColor: colors.primary + "18" }]}>
                      <Text style={[styles.bestBadgeText, { color: colors.primary }]}>BEST EXPERIENCE</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.promise, { color: colors.primary }]}>{plan.promise}</Text>
              </View>
              <View style={[styles.priceWrap, compactLayout && styles.priceWrapCompact]}>
                <Text style={[styles.price, { color: colors.foreground }]}>
                  {price === 0 ? "$0" : localizedProPrice || "Store price"}
                </Text>
                <Text style={[styles.priceCadence, { color: colors.mutedForeground }]}>
                  {price === 0 ? "forever" : billingCadence === "annual" ? "/year" : "/month"}
                </Text>
              </View>
            </View>
            {tier === "pro" && billingCadence === "annual" && localizedProPrice ? (
              <Text style={[styles.savings, compactLayout && styles.savingsCompact, { color: colors.success }]}>
                Annual subscription · exact localized price shown by your store
              </Text>
            ) : null}
            <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>{plan.description}</Text>
            <View style={styles.highlightList}>
              {plan.highlights.map(highlight => (
                <View key={highlight} style={styles.highlightRow}>
                  <Feather name="check" size={15} color={colors.success} />
                  <Text style={[styles.highlightText, { color: colors.foreground }]}>{highlight}</Text>
                </View>
              ))}
            </View>
            {tier === "pro" && !isCurrent && canManageBilling ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Subscribe to Pro for ${activeHousehold?.name ?? "the active household"}`}
                disabled={billingBusy !== null}
                onPress={() => void purchasePro()}
                style={({ pressed }) => [styles.planButton, { backgroundColor: colors.primary, opacity: pressed || billingBusy ? 0.72 : 1 }]}
              >
                {billingBusy === "purchase" ? <ActivityIndicator color="#fff" /> : (
                  <Text style={[styles.planButtonText, { color: "#fff" }]}>Subscribe · no trial</Text>
                )}
              </Pressable>
            ) : (
              <View style={[styles.planButton, { backgroundColor: isCurrent ? colors.success + "18" : colors.muted }]}>
                <Text style={[styles.planButtonText, { color: isCurrent ? colors.success : colors.mutedForeground }]}>
                  {isCurrent ? "Current plan" : nativeStore ? "Household owner required" : "Subscribe in the mobile app"}
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {lifecycleMessage ? (
        <Text accessibilityLiveRegion="polite" style={[styles.billingNote, { color: colors.warning }]}>{lifecycleMessage}</Text>
      ) : null}
      {billingMessage ? (
        <Text accessibilityLiveRegion="polite" style={[styles.billingNote, { color: colors.foreground }]}>{billingMessage}</Text>
      ) : null}
      {canManageBilling ? (
        <View style={styles.billingActions}>
          <Pressable
            accessibilityRole="button"
            disabled={billingBusy !== null}
            onPress={() => void restorePro()}
            style={[styles.secondaryButton, { borderColor: colors.border }]}
          >
            {billingBusy === "restore" ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Restore purchase</Text>}
          </Pressable>
          {actualPlan.source === "billing" ? (
            <Pressable
              accessibilityRole="button"
              disabled={billingBusy !== null}
              onPress={() => void managePro()}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              {billingBusy === "manage" ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Manage subscription</Text>}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        Payment is charged to your Apple App Store or Google Play account at the localized price shown above and again in the store confirmation. Pro renews automatically unless cancelled through that store. No free trial.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  currentCard: { borderWidth: 1, borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  currentCardCompact: { alignItems: "flex-start", flexDirection: "column", padding: 12 },
  planIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  currentCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  currentTitle: { fontSize: 23, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  currentDescription: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  earlyAccess: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  earlyAccessText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  cadence: { alignSelf: "center", flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4 },
  cadenceCompact: { alignSelf: "stretch" },
  cadenceButton: { minWidth: 112, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cadenceButtonCompact: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  cadenceText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  planCard: { borderWidth: 1, borderRadius: 20, padding: 17 },
  planCardCompact: { padding: 12 },
  planHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  planHeaderCompact: { flexDirection: "column", gap: 6 },
  planNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  planName: { fontSize: 23, fontFamily: "Inter_800ExtraBold" },
  bestBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  bestBadgeText: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  promise: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  priceWrap: { alignItems: "flex-end" },
  priceWrapCompact: { alignItems: "flex-start" },
  price: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  priceCadence: { fontSize: 10, fontFamily: "Inter_500Medium" },
  savings: { fontSize: 11, fontFamily: "Inter_700Bold", textAlign: "right", marginTop: 4 },
  savingsCompact: { textAlign: "left" },
  planDescription: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 12 },
  highlightList: { gap: 8, marginTop: 13 },
  highlightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  highlightText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  planButton: { minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 15 },
  planButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  billingActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  secondaryButton: { minHeight: 44, flexGrow: 1, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  secondaryButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  billingNote: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  disclosure: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_400Regular" },
});

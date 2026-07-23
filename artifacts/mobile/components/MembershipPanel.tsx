import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { PLAN_CATALOG, PLAN_TIERS, annualMonthlyEquivalent, annualSavings, type PlanTier } from "@/lib/membership";
import { isCompactMembershipLayout } from "@/lib/membershipLayout";

export function MembershipPanel() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactMembershipLayout(viewportWidth);
  const { actualPlan, previewTier, loading } = useMembership();
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">("annual");

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
                  {price === 0 ? "$0" : `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`}
                </Text>
                <Text style={[styles.priceCadence, { color: colors.mutedForeground }]}>
                  {price === 0 ? "forever" : billingCadence === "annual" ? "/year" : "/month"}
                </Text>
              </View>
            </View>
            {tier === "pro" && billingCadence === "annual" ? (
              <Text style={[styles.savings, compactLayout && styles.savingsCompact, { color: colors.success }]}>
                ${annualMonthlyEquivalent("pro").toFixed(2)}/month · save ${annualSavings("pro").toFixed(2)} yearly
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
            <View style={[styles.planButton, { backgroundColor: isCurrent ? colors.success + "18" : colors.muted }]}>
              <Text style={[styles.planButtonText, { color: isCurrent ? colors.success : colors.mutedForeground }]}>
                {isCurrent ? "Current plan" : "Coming soon"}
              </Text>
            </View>
          </View>
        );
      })}
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
  cadenceButton: { minWidth: 112, minHeight: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
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
  planButton: { minHeight: 43, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 15 },
  planButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

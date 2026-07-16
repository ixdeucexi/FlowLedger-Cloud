import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { PLAN_CATALOG, PLAN_TIERS, annualMonthlyEquivalent, annualSavings, type PlanTier } from "@/lib/membership";

export function MembershipPanel() {
  const c = useColors();
  const { session } = useAuth();
  const { actualPlan, previewTier, isAdmin, loading, setPreviewTier, resetPreview } = useMembership();
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">("annual");
  const [testerEmail, setTesterEmail] = useState("");
  const [testerBusy, setTesterBusy] = useState(false);
  const [testerMessage, setTesterMessage] = useState("");

  const setTesterPlan = async (tier: PlanTier) => {
    if (!session?.access_token || !testerEmail.trim() || testerBusy) return;
    setTesterBusy(true);
    setTesterMessage("");
    try {
      const response = await fetch("/api/admin/tester-plan", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: testerEmail.trim(), tier }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; householdName?: string };
      if (!response.ok) throw new Error(payload.message || "Could not update tester access.");
      setTesterMessage(`${testerEmail.trim()} now has ${PLAN_CATALOG[tier].name} on ${payload.householdName || "their household"}. They can refresh to test it.`);
    } catch (error) {
      setTesterMessage(error instanceof Error ? error.message : "Could not update tester access.");
    } finally {
      setTesterBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.currentCard, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
        <View style={[styles.planIcon, { backgroundColor: c.primary + "18" }]}>
          <Feather name="award" size={22} color={c.primary} />
        </View>
        <View style={styles.currentCopy}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>CURRENT HOUSEHOLD PLAN</Text>
          <Text style={[styles.currentTitle, { color: c.foreground }]}>{loading ? "Loading…" : PLAN_CATALOG[actualPlan.tier].name}</Text>
          <Text style={[styles.currentDescription, { color: c.mutedForeground }]}>
            {actualPlan.source === "grandfathered" ? "Grandfathered Pro access · no expiration" : actualPlan.source === "admin" ? "Pro granted by a FlowLedger admin" : "Your household's live plan"}
          </Text>
        </View>
      </View>

      <View style={[styles.earlyAccess, { backgroundColor: c.success + "10", borderColor: c.success + "35" }]}>
        <Feather name="check-circle" size={17} color={c.success} />
        <Text style={[styles.earlyAccessText, { color: c.foreground }]}>Basic Flo and manual planning are included with Free. Bank connections, reconciliation, and account-aware Flo require Pro.</Text>
      </View>

      {isAdmin ? (<>
        <View style={[styles.adminCard, { backgroundColor: c.card, borderColor: c.warning + "55" }]}>
          <View style={styles.adminHeader}>
            <Feather name="tool" size={18} color={c.warning} />
            <View style={styles.currentCopy}>
              <Text style={[styles.adminTitle, { color: c.foreground }]}>Admin Plan Preview</Text>
              <Text style={[styles.adminDescription, { color: c.mutedForeground }]}>Test future locks on this device without changing the household’s real plan.</Text>
            </View>
          </View>
          <View style={styles.adminActions}>
            {PLAN_TIERS.map(tier => {
              const selected = previewTier === tier;
              return (
                <Pressable
                  key={tier}
                  accessibilityRole="button"
                  accessibilityLabel={`Preview ${PLAN_CATALOG[tier].name} plan`}
                  onPress={() => void setPreviewTier(tier)}
                  style={({ pressed }) => [styles.previewButton, { backgroundColor: selected ? c.primary : c.muted, borderColor: selected ? c.primary : c.border, opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[styles.previewButtonText, { color: selected ? c.primaryForeground : c.foreground }]}>{PLAN_CATALOG[tier].name}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset to actual household plan"
              disabled={!previewTier}
              onPress={() => void resetPreview()}
              style={({ pressed }) => [styles.previewButton, { backgroundColor: c.muted, borderColor: c.border, opacity: !previewTier ? 0.45 : pressed ? 0.75 : 1 }]}
            >
              <Text style={[styles.previewButtonText, { color: c.mutedForeground }]}>Reset</Text>
            </Pressable>
          </View>
        </View>
        <View style={[styles.adminCard, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
          <View style={styles.adminHeader}>
            <Feather name="user-check" size={18} color={c.primary} />
            <View style={styles.currentCopy}>
              <Text style={[styles.adminTitle, { color: c.foreground }]}>Tester Access</Text>
              <Text style={[styles.adminDescription, { color: c.mutedForeground }]}>Grant or remove real Pro access for a tester's personal household. This is separate from Plan Preview.</Text>
            </View>
          </View>
          <TextInput
            accessibilityLabel="Tester email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="tester@example.com"
            placeholderTextColor={c.mutedForeground}
            value={testerEmail}
            onChangeText={setTesterEmail}
            style={[styles.testerInput, { color: c.foreground, backgroundColor: c.muted, borderColor: c.border }]}
          />
          <View style={styles.adminActions}>
            <Pressable
              disabled={testerBusy || !testerEmail.trim()}
              onPress={() => void setTesterPlan("pro")}
              style={({ pressed }) => [styles.testerButton, { backgroundColor: c.primary, opacity: testerBusy || !testerEmail.trim() ? 0.45 : pressed ? 0.76 : 1 }]}
            >
              <Text style={[styles.previewButtonText, { color: c.primaryForeground }]}>{testerBusy ? "Saving…" : "Grant Pro"}</Text>
            </Pressable>
            <Pressable
              disabled={testerBusy || !testerEmail.trim()}
              onPress={() => void setTesterPlan("free")}
              style={({ pressed }) => [styles.testerButton, { backgroundColor: c.muted, borderColor: c.border, opacity: testerBusy || !testerEmail.trim() ? 0.45 : pressed ? 0.76 : 1 }]}
            >
              <Text style={[styles.previewButtonText, { color: c.foreground }]}>Return to Free</Text>
            </Pressable>
          </View>
          {testerMessage ? <Text style={[styles.testerMessage, { color: testerMessage.includes("now has") ? c.success : c.destructive }]}>{testerMessage}</Text> : null}
        </View>
      </>) : null}

      <View style={[styles.cadence, { backgroundColor: c.muted, borderColor: c.border }]}>
        {(["monthly", "annual"] as const).map(cadence => {
          const selected = billingCadence === cadence;
          return (
            <Pressable
              key={cadence}
              accessibilityRole="button"
              accessibilityLabel={`Show ${cadence} pricing`}
              onPress={() => setBillingCadence(cadence)}
              style={[styles.cadenceButton, { backgroundColor: selected ? c.card : "transparent" }]}
            >
              <Text style={[styles.cadenceText, { color: selected ? c.foreground : c.mutedForeground }]}>{cadence === "annual" ? "Annual · save" : "Monthly"}</Text>
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
          <View key={tier} style={[styles.planCard, { backgroundColor: c.card, borderColor: isPreview ? c.warning : tier === "pro" ? c.primary + "66" : c.border }]}>
            <View style={styles.planHeader}>
              <View style={styles.currentCopy}>
                <View style={styles.planNameRow}>
                  <Text style={[styles.planName, { color: c.foreground }]}>{plan.name}</Text>
                  {tier === "pro" ? <View style={[styles.bestBadge, { backgroundColor: c.primary + "18" }]}><Text style={[styles.bestBadgeText, { color: c.primary }]}>BEST EXPERIENCE</Text></View> : null}
                </View>
                <Text style={[styles.promise, { color: c.primary }]}>{plan.promise}</Text>
              </View>
              <View style={styles.priceWrap}>
                <Text style={[styles.price, { color: c.foreground }]}>{price === 0 ? "$0" : `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`}</Text>
                <Text style={[styles.priceCadence, { color: c.mutedForeground }]}>{price === 0 ? "forever" : billingCadence === "annual" ? "/year" : "/month"}</Text>
              </View>
            </View>
            {tier === "pro" && billingCadence === "annual" ? (
              <Text style={[styles.savings, { color: c.success }]}>${annualMonthlyEquivalent("pro").toFixed(2)}/month · save ${annualSavings("pro").toFixed(2)} yearly</Text>
            ) : null}
            <Text style={[styles.planDescription, { color: c.mutedForeground }]}>{plan.description}</Text>
            <View style={styles.highlightList}>
              {plan.highlights.map(highlight => (
                <View key={highlight} style={styles.highlightRow}>
                  <Feather name="check" size={15} color={c.success} />
                  <Text style={[styles.highlightText, { color: c.foreground }]}>{highlight}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.planButton, { backgroundColor: isCurrent ? c.success + "18" : c.muted }]}>
              <Text style={[styles.planButtonText, { color: isCurrent ? c.success : c.mutedForeground }]}>{isCurrent ? "Current plan" : "Coming soon"}</Text>
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
  planIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  currentCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8 },
  currentTitle: { fontSize: 23, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  currentDescription: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 3 },
  earlyAccess: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  earlyAccessText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  adminCard: { borderWidth: 1, borderRadius: 18, padding: 14 },
  adminHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  adminTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  adminDescription: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },
  adminActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  previewButton: { minHeight: 40, minWidth: 78, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  previewButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  testerInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 12 },
  testerButton: { flex: 1, minHeight: 43, minWidth: 120, borderWidth: 1, borderColor: "transparent", borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  testerMessage: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_700Bold", marginTop: 10 },
  cadence: { alignSelf: "center", flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4 },
  cadenceButton: { minWidth: 112, minHeight: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cadenceText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  planCard: { borderWidth: 1, borderRadius: 20, padding: 17 },
  planHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  planNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  planName: { fontSize: 23, fontFamily: "Inter_800ExtraBold" },
  bestBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  bestBadgeText: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.5 },
  promise: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  priceWrap: { alignItems: "flex-end" },
  price: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  priceCadence: { fontSize: 10, fontFamily: "Inter_500Medium" },
  savings: { fontSize: 11, fontFamily: "Inter_700Bold", textAlign: "right", marginTop: 4 },
  planDescription: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 12 },
  highlightList: { gap: 8, marginTop: 13 },
  highlightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  highlightText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  planButton: { minHeight: 43, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 15 },
  planButtonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

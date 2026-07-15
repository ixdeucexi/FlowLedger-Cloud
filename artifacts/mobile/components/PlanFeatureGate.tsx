import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { PLAN_FEATURE_COPY, type PlanFeature } from "@/lib/membership";

export function PlanFeatureGate({ feature, children, compact = false }: { feature: Exclude<PlanFeature, "manual_budgeting">; children: React.ReactNode; compact?: boolean }) {
  const c = useColors();
  const { isFeatureLocked, bypassFeature, isAdmin, previewTier } = useMembership();

  if (!isFeatureLocked(feature)) return <>{children}</>;

  const copy = PLAN_FEATURE_COPY[feature];
  return (
    <View style={[styles.card, compact && styles.compact, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
      <View style={[styles.icon, { backgroundColor: c.primary + "18" }]}>
        <Feather name="lock" size={20} color={c.primary} />
      </View>
      <Text style={[styles.eyebrow, { color: c.primary }]}>{previewTier ? "FREE PLAN PREVIEW" : "PRO FEATURE"}</Text>
      <Text style={[styles.title, { color: c.foreground }]}>{copy.title}</Text>
      <Text style={[styles.description, { color: c.mutedForeground }]}>{copy.description}</Text>
      <Text style={[styles.note, { color: c.mutedForeground }]}>{previewTier ? "This is only a test lock. Your real household plan is unchanged." : "Upgrade controls are coming with billing. Your manual FlowLedger tools remain available."}</Text>
      {isAdmin && previewTier ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Admin bypass for ${copy.title}`}
          onPress={() => bypassFeature(feature)}
          style={({ pressed }) => [styles.button, { backgroundColor: c.primary, opacity: pressed ? 0.78 : 1 }]}
        >
          <Feather name="unlock" size={15} color={c.primaryForeground} />
          <Text style={[styles.buttonText, { color: c.primaryForeground }]}>Admin bypass</Text>
        </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minHeight: 320, borderWidth: 1, borderRadius: 24, margin: 16, padding: 24, alignItems: "center", justifyContent: "center" },
  compact: { flex: 0, minHeight: 0, marginHorizontal: 0, marginVertical: 10, padding: 18 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 },
  title: { fontSize: 21, fontFamily: "Inter_800ExtraBold", textAlign: "center", marginTop: 6 },
  description: { maxWidth: 420, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center", marginTop: 8 },
  note: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 10 },
  button: { minHeight: 44, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18, marginTop: 16 },
  buttonText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

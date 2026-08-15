import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { flowmentumPreviewStorageKey } from "@/lib/flowmentumHandoff";
import { PLAN_CATALOG, PLAN_TIERS, type PlanTier } from "@/lib/membership";
import { desktopPalette as palette } from "@/components/desktop/DesktopUI";
import { apiFetch } from "@/lib/api";

export function AdminMembershipTools({ appearance = "theme" }: { appearance?: "theme" | "desktop" | "settings" }) {
  const themeColors = useColors();
  const isDesktop = appearance !== "theme";
  const isSettings = appearance === "settings";
  const colors = isDesktop ? {
    ...themeColors,
    card: palette.surface,
    foreground: palette.text,
    mutedForeground: palette.muted,
    muted: palette.surfaceMuted,
    border: palette.border,
    primary: palette.purple,
    success: palette.green,
    destructive: palette.red,
    warning: palette.amber,
  } : themeColors;
  const router = useRouter();
  const { session, user } = useAuth();
  const { actualPlan, previewTier, setPreviewTier, resetPreview } = useMembership();
  const [testerEmail, setTesterEmail] = useState("");
  const [testerBusy, setTesterBusy] = useState(false);
  const [testerMessage, setTesterMessage] = useState("");

  const setTesterPlan = async (tier: PlanTier) => {
    if (!session?.access_token || !testerEmail.trim() || testerBusy) return;
    setTesterBusy(true);
    setTesterMessage("");
    try {
      const response = await apiFetch("/api/admin/tester-plan", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: testerEmail.trim(), tier }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; householdName?: string };
      if (!response.ok) throw new Error(payload.message || "Could not update tester access.");
      setTesterMessage(
        `${testerEmail.trim()} now has ${PLAN_CATALOG[tier].name} on ${payload.householdName || "their household"}.`,
      );
    } catch (error) {
      setTesterMessage(error instanceof Error ? error.message : "Could not update tester access.");
    } finally {
      setTesterBusy(false);
    }
  };

  const previewFlowmentumHandoff = async () => {
    if (!user?.id) return;
    const key = flowmentumPreviewStorageKey(user.id, actualPlan.householdId || "personal");
    await AsyncStorage.setItem(key, "true");
    router.replace("/(tabs)" as any);
  };

  return (
    <View style={[styles.container, isDesktop && styles.desktopContainer, isSettings && styles.settingsContainer]}>
      <View style={[styles.card, isDesktop && styles.desktopCard, isSettings && styles.settingsSection, { backgroundColor: isSettings ? "transparent" : colors.card, borderColor: isDesktop ? colors.border : colors.warning + "55" }]}>
        <View style={styles.header}>
          <Feather name="tool" size={18} color={colors.warning} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>Plan Preview</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Test Basic or Pro locks on this device.
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          {PLAN_TIERS.map(tier => {
            const selected = previewTier === tier;
            return (
              <Pressable
                key={tier}
                accessibilityRole="button"
                accessibilityLabel={`Preview ${PLAN_CATALOG[tier].name} plan`}
                onPress={() => void setPreviewTier(tier)}
                style={({ pressed }) => [
                  styles.previewButton,
                  isDesktop && styles.desktopControl,
                  {
                    backgroundColor: selected ? colors.primary : colors.muted,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                  {PLAN_CATALOG[tier].name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset to actual household plan"
            disabled={!previewTier}
            onPress={() => void resetPreview()}
            style={({ pressed }) => [
              styles.previewButton,
              isDesktop && styles.desktopControl,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                opacity: !previewTier ? 0.45 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.mutedForeground }]}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.card, isDesktop && styles.desktopCard, isSettings && styles.settingsSection, isSettings && styles.settingsDivider, { backgroundColor: isSettings ? "transparent" : colors.card, borderColor: isDesktop ? colors.border : colors.success + "55" }]}>
        <View style={styles.header}>
          <Feather name="trending-up" size={18} color={colors.success} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>180-Day Handoff Preview</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Test the hidden milestone without changing money or protected days.
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preview the 180-day Flowmentum handoff"
            disabled={!user?.id}
            onPress={() => void previewFlowmentumHandoff()}
            style={({ pressed }) => [
              styles.testerButton,
              isDesktop && styles.desktopControl,
              {
                backgroundColor: colors.success,
                opacity: !user?.id ? 0.45 : pressed ? 0.76 : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: "#052e16" }]}>Preview handoff</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.card, isDesktop && styles.desktopCard, isSettings && styles.settingsSection, isSettings && styles.settingsDivider, { backgroundColor: isSettings ? "transparent" : colors.card, borderColor: isDesktop ? colors.border : colors.primary + "55" }]}>
        <View style={styles.header}>
          <Feather name="user-check" size={18} color={colors.primary} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>Tester Access</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Change a tester household&apos;s real plan.
            </Text>
          </View>
        </View>
        <TextInput
          accessibilityLabel="Tester email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="tester@example.com"
          placeholderTextColor={colors.mutedForeground}
          value={testerEmail}
          onChangeText={setTesterEmail}
          style={[styles.input, isDesktop && styles.desktopInput, { color: colors.foreground, backgroundColor: colors.muted, borderColor: colors.border }]}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Grant Pro access to tester"
            disabled={testerBusy || !testerEmail.trim()}
            onPress={() => void setTesterPlan("pro")}
            style={({ pressed }) => [
              styles.testerButton,
              isDesktop && styles.desktopControl,
              {
                backgroundColor: colors.primary,
                opacity: testerBusy || !testerEmail.trim() ? 0.45 : pressed ? 0.76 : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              {testerBusy ? "Saving…" : "Grant Pro"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return tester to Basic access"
            disabled={testerBusy || !testerEmail.trim()}
            onPress={() => void setTesterPlan("free")}
            style={({ pressed }) => [
              styles.testerButton,
              isDesktop && styles.desktopControl,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                opacity: testerBusy || !testerEmail.trim() ? 0.45 : pressed ? 0.76 : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.foreground }]}>Return to Basic</Text>
          </Pressable>
        </View>
        {testerMessage ? (
          <Text style={[styles.message, { color: testerMessage.includes("now has") ? colors.success : colors.destructive }]}>
            {testerMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  desktopContainer: { gap: 12 },
  settingsContainer: { gap: 0 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14 },
  desktopCard: { borderRadius: 10, padding: 16 },
  settingsSection: { borderWidth: 0, borderRadius: 0, paddingHorizontal: 15, paddingVertical: 14 },
  settingsDivider: { borderTopWidth: 1, borderTopColor: palette.borderSoft },
  desktopControl: { minHeight: 38, borderRadius: 7 },
  desktopInput: { minHeight: 38, borderRadius: 7, fontSize: 11 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  copy: { flex: 1 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  description: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  previewButton: {
    minHeight: 40,
    minWidth: 78,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginTop: 12,
  },
  testerButton: {
    flex: 1,
    minHeight: 43,
    minWidth: 120,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  message: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_700Bold", marginTop: 10 },
});

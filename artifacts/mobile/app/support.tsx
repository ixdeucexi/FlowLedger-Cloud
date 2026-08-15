import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { LEGAL_EMAIL } from "@/lib/legalDocuments";

const SUPPORT_STEPS = [
  { icon: "refresh-cw" as const, title: "Plan not refreshed", body: "Check your connection, reopen FlowLedger, then use Retry. A failed refresh never confirms a money change as saved." },
  { icon: "link" as const, title: "Bank connection needs attention", body: "Open Settings → Accounts & bank sync. Reconnect only when FlowLedger asks; never send bank credentials by email." },
  { icon: "check-circle" as const, title: "A payment looks wrong", body: "Open Activity or Forecast and review the matched record. Send feedback with the date and item name—never a full account number." },
] as const;

export default function SupportScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const build = Constants.nativeBuildVersion ?? "development";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <PremiumBackdrop variant="blue" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/login" as any)} style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>FLOWLEDGER SUPPORT</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>How can we help?</Text>
          </View>
        </View>

        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}1f` }]}><Feather name="message-circle" size={26} color={colors.primary} /></View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Talk to a real person</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>Include the screen, item name, and date. Do not email passwords, full account numbers, or Social Security numbers.</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`mailto:${LEGAL_EMAIL}?subject=FlowLedger%20Support`)} style={[styles.emailButton, { backgroundColor: colors.primary }]}>
            <Feather name="mail" size={18} color={colors.primaryForeground} />
            <Text style={[styles.emailText, { color: colors.primaryForeground }]}>Email {LEGAL_EMAIL}</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick recovery steps</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {SUPPORT_STEPS.map((step, index) => (
            <View key={step.title} style={[styles.row, index ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
              <View style={[styles.rowIcon, { backgroundColor: `${colors.primary}14` }]}><Feather name={step.icon} size={18} color={colors.primary} /></View>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{step.title}</Text>
                <Text style={[styles.rowText, { color: colors.mutedForeground }]}>{step.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable accessibilityRole="link" onPress={() => router.push("/delete-account" as never)} style={[styles.deletionLink, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={[styles.rowIcon, { backgroundColor: `${colors.destructive}14` }]}><Feather name="trash-2" size={18} color={colors.destructive} /></View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Request account deletion</Text>
            <Text style={[styles.rowText, { color: colors.mutedForeground }]}>Start a verified request without signing in.</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.note, { color: colors.mutedForeground }]}>FlowLedger organizes and forecasts your plan; it does not move money or make bank payments. App version {version} · build {build}.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 20 },
  backButton: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: 1.7, fontFamily: "Inter_800ExtraBold" },
  title: { marginTop: 3, fontSize: 30, fontFamily: "Inter_800ExtraBold" },
  hero: { borderWidth: 1, borderRadius: 24, padding: 22, alignItems: "center" },
  heroIcon: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  heroTitle: { marginTop: 13, fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  heroBody: { marginTop: 7, maxWidth: 520, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: "Inter_500Medium" },
  emailButton: { minHeight: 50, marginTop: 18, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18 },
  emailText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { marginTop: 26, marginBottom: 10, fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  list: { borderWidth: 1, borderRadius: 22, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 13, padding: 17 },
  rowIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  rowText: { marginTop: 4, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  note: { marginTop: 20, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: "Inter_500Medium" },
  deletionLink: { minHeight: 64, marginTop: 16, borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
});

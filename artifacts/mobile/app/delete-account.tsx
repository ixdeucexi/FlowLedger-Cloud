import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { LEGAL_EMAIL } from "@/lib/legalDocuments";

const REQUEST_SUBJECT = "FlowLedger account deletion request";

export default function DeleteAccountRequestScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requestUrl = `mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent(REQUEST_SUBJECT)}&body=${encodeURIComponent("Please begin a FlowLedger account deletion request for the email address sending this message. I understand FlowLedger will verify my identity and explain how shared household data will be handled before deletion.")}`;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <PremiumBackdrop variant="purple" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/login" as never)} style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>DATA & PRIVACY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Request account deletion</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: `${colors.destructive}18` }]}><Feather name="trash-2" size={24} color={colors.destructive} /></View>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>We verify before deleting</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Send the request from your FlowLedger account email. Support will verify your identity and explain whether you own a shared household that must be transferred or deleted first.</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(requestUrl)} style={[styles.requestButton, { backgroundColor: colors.destructive }]}>
            <Feather name="mail" size={18} color="#fff" />
            <Text style={styles.requestText}>Email deletion request</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What to expect</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            "FlowLedger confirms the request belongs to you before changing account data.",
            "Shared household ownership and records are reviewed so another member’s plan is not deleted by mistake.",
            "Connected-bank access, private Flo history, device registrations, and account access are included in the reviewed deletion scope.",
            "Some security, support, consent, or legal records may be retained when required or permitted by law.",
          ].map((item, index) => (
            <View key={item} style={[styles.row, index ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
              <View style={[styles.number, { backgroundColor: `${colors.primary}18` }]}><Text style={[styles.numberText, { color: colors.primary }]}>{index + 1}</Text></View>
              <Text style={[styles.rowText, { color: colors.mutedForeground }]}>{item}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.note, { color: colors.mutedForeground }]}>Do not send passwords, bank credentials, Social Security numbers, or full account numbers. Account deletion is permanent after verification and completion.</Text>
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
  title: { marginTop: 3, fontSize: 28, lineHeight: 34, fontFamily: "Inter_800ExtraBold" },
  card: { borderWidth: 1, borderRadius: 24, padding: 22, alignItems: "center" },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardTitle: { marginTop: 13, fontSize: 21, fontFamily: "Inter_800ExtraBold" },
  body: { marginTop: 8, maxWidth: 540, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: "Inter_500Medium" },
  requestButton: { minHeight: 50, marginTop: 18, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18 },
  requestText: { color: "#fff", fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  sectionTitle: { marginTop: 26, marginBottom: 10, fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  list: { borderWidth: 1, borderRadius: 22, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  number: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  numberText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  rowText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  note: { marginTop: 20, fontSize: 12, lineHeight: 18, textAlign: "center", fontFamily: "Inter_500Medium" },
});

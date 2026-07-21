import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LegalDocumentContent } from "@/components/LegalDocumentContent";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { legalDocumentById, type LegalDocumentId } from "@/lib/legalDocuments";

function requestedDocument(value: string | string[] | undefined): LegalDocumentId {
  return value === "privacy" ? "privacy" : "terms";
}

export default function LegalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ doc?: string | string[] }>();
  const [documentId, setDocumentId] = useState<LegalDocumentId>(() => requestedDocument(params.doc));
  const document = legalDocumentById(documentId);

  const chooseDocument = (next: LegalDocumentId) => {
    setDocumentId(next);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/legal?doc=${next}`);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <PremiumBackdrop variant="purple" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 36 }]}>
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/login")} style={[styles.back, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </Pressable>
          <View style={styles.headingCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>FLOWLEDGER ALGO</Text>
            <Text style={[styles.heading, { color: colors.foreground }]}>Legal & privacy</Text>
          </View>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["terms", "privacy"] as const).map(id => (
            <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: documentId === id }} onPress={() => chooseDocument(id)} style={[styles.tab, documentId === id && { backgroundColor: colors.primary }]}>
              <Text style={[styles.tabText, { color: documentId === id ? colors.primaryForeground : colors.mutedForeground }]}>{legalDocumentById(id).title}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.documentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.documentTitle, { color: colors.foreground }]}>{document.title}</Text>
          <LegalDocumentContent documentId={documentId} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 18 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  back: { width: 44, height: 44, borderWidth: 1, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  heading: { fontSize: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.75, marginTop: 2 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: 16, padding: 4, marginBottom: 16 },
  tab: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  tabText: { fontSize: 13, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  documentCard: { borderWidth: 1, borderRadius: 22, padding: 18 },
  documentTitle: { fontSize: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, marginBottom: 15 },
});

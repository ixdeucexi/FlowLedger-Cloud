import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_OPERATOR,
  legalDocumentById,
  type LegalDocumentId,
} from "@/lib/legalDocuments";

export function LegalDocumentContent({ documentId }: { documentId: LegalDocumentId }) {
  const colors = useColors();
  const document = legalDocumentById(documentId);
  const plainLanguage = documentId === "terms"
    ? [
        "FlowLedger helps you plan, but it is not a bank or a substitute for financial, legal, tax, or investment advice.",
        "Bank data, forecasts, Flo answers, and alerts can be delayed or wrong. Check important amounts and dates before acting.",
        "You are responsible for your account, the people you invite, and the financial decisions you make.",
        "The Terms include individual arbitration, a class-action waiver, and a 30-day opt-out right.",
      ]
    : [
        "We use the information you provide, including connected-bank data, to run and improve FlowLedger.",
        "Trusted providers such as Plaid, hosting, notification, and AI services may process data for us.",
        "You can disconnect accounts and request access, correction, or deletion as explained below.",
        "We use safeguards, but no online service can promise perfect security.",
      ];

  return (
    <View>
      <View style={[styles.notice, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
        <Text style={[styles.noticeTitle, { color: colors.foreground }]}>{LEGAL_OPERATOR}</Text>
        <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>Effective {LEGAL_EFFECTIVE_DATE}</Text>
        <Text style={[styles.summary, { color: colors.mutedForeground }]}>{document.summary}</Text>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Text style={[styles.summaryTitle, { color: colors.foreground }]}>Quick, plain-language summary</Text>
        {plainLanguage.map(item => (
          <View key={item} style={styles.summaryRow}>
            <Text style={[styles.summaryBullet, { color: colors.primary }]}>•</Text>
            <Text style={[styles.summaryItem, { color: colors.mutedForeground }]}>{item}</Text>
          </View>
        ))}
        <Text style={[styles.summaryControl, { color: colors.mutedForeground }]}>This summary is only a guide. The complete document below remains the legal agreement.</Text>
      </View>

      {document.sections.map(section => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
          {section.paragraphs.map((paragraph, index) => (
            <Text key={`${section.title}-${index}`} style={[styles.paragraph, { color: colors.mutedForeground }]}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 20 },
  noticeTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  noticeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  summary: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 9 },
  summaryCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 20, gap: 8 },
  summaryTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", marginBottom: 2 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  summaryBullet: { fontSize: 17, lineHeight: 19, fontFamily: "Inter_800ExtraBold" },
  summaryItem: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_500Medium" },
  summaryControl: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_700Bold", marginTop: 4 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", lineHeight: 21, marginBottom: 8 },
  paragraph: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 9 },
});

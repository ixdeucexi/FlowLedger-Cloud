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

  return (
    <View>
      <View style={[styles.notice, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
        <Text style={[styles.noticeTitle, { color: colors.foreground }]}>{LEGAL_OPERATOR}</Text>
        <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>Effective {LEGAL_EFFECTIVE_DATE}</Text>
        <Text style={[styles.summary, { color: colors.mutedForeground }]}>{document.summary}</Text>
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
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", lineHeight: 21, marginBottom: 8 },
  paragraph: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 9 },
});

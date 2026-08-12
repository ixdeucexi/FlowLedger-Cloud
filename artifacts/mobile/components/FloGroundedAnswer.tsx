import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { floFreshnessLabel, oldestFloSourceAsOf, safeFloSourceRoute, type FloEvidenceRef, type FloReviewProposal } from "@/lib/floExperience";

type Props = {
  text: string;
  sources: FloEvidenceRef[];
  dataAsOf?: string | null;
  partial?: boolean;
  coverage?: string;
  followUps?: string[];
  caveat?: string;
  proposal?: FloReviewProposal | null;
  proposalConfirmed?: boolean;
  onOpenSource: (route: string) => void;
  onFollowUp: (question: string) => void;
  onReviewProposal: (proposal: FloReviewProposal) => void;
};

export function FloGroundedAnswer({ text, sources, dataAsOf, partial, coverage, followUps = [], caveat, proposal, proposalConfirmed, onOpenSource, onFollowUp, onReviewProposal }: Props) {
  const c = useColors();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const freshnessAsOf = dataAsOf ?? oldestFloSourceAsOf(sources);

  return (
    <View>
      <Text style={[styles.answer, { color: c.foreground }]}>{text}</Text>
      {caveat ? <View accessibilityRole="alert" style={[styles.caveat, { backgroundColor: c.warning + "14", borderColor: c.warning + "55" }]}><Feather name="alert-triangle" size={15} color={c.warning} /><Text style={[styles.caveatText, { color: c.foreground }]}>{caveat}</Text></View> : null}
      {sources.length || freshnessAsOf || partial ? (
        <View style={[styles.grounding, { borderColor: partial ? c.warning : c.border, backgroundColor: partial ? c.warning + "0D" : c.muted + "70" }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: evidenceOpen }} accessibilityLabel="Show how Flo got this answer" onPress={() => setEvidenceOpen(open => !open)} style={styles.groundingHeader}>
            <Feather name={partial ? "alert-triangle" : "shield"} size={14} color={partial ? c.warning : c.success} />
            <View style={styles.groundingCopy}>
              <Text style={[styles.groundingTitle, { color: c.foreground }]}>{partial ? "Some account data was unavailable" : "Grounded in your FlowLedger plan"}</Text>
              <Text style={[styles.groundingMeta, { color: c.mutedForeground }]}>{freshnessAsOf ? floFreshnessLabel(freshnessAsOf) : "Freshness unavailable"}{coverage ? ` · ${coverage}` : ""}</Text>
            </View>
            <Feather name={evidenceOpen ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
          </Pressable>
          {evidenceOpen ? (
            <View style={styles.evidenceList}>
              {sources.map((source, index) => {
                const route = safeFloSourceRoute(source.route);
                const key = source.id ?? `${source.type}-${source.recordId ?? source.label}-${index}`;
                const body = (
                  <>
                    <View style={[styles.sourceIcon, { backgroundColor: c.primary + "16" }]}><Feather name="database" size={12} color={c.primary} /></View>
                    <View style={styles.sourceCopy}><Text style={[styles.sourceLabel, { color: c.foreground }]}>{source.label}</Text><Text style={[styles.sourceMeta, { color: c.mutedForeground }]}>{source.freshness ? `${source.freshness} · ` : ""}{floFreshnessLabel(source.asOf ?? dataAsOf)}</Text></View>
                    {route ? <Feather name="arrow-up-right" size={14} color={c.primary} /> : null}
                  </>
                );
                return route ? (
                  <Pressable key={key} accessibilityRole="link" accessibilityLabel={`Open source ${source.label}`} onPress={() => onOpenSource(route)} style={[styles.source, { borderColor: c.border }]}>{body}</Pressable>
                ) : <View key={key} style={[styles.source, { borderColor: c.border }]}>{body}</View>;
              })}
              {!sources.length ? <Text style={[styles.noSources, { color: c.mutedForeground }]}>Flo could not attach record-level sources to this answer.</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {proposal?.kind === "recurring_bill_change" ? (
        <View style={[styles.proposal, { backgroundColor: c.primary + "0D", borderColor: proposalConfirmed ? c.success : c.primary + "45" }]}>
          <Text style={[styles.proposalEyebrow, { color: proposalConfirmed ? c.success : c.primary }]}>{proposalConfirmed ? "CHANGE CONFIRMED" : "REVIEW REQUIRED"}</Text>
          <Text style={[styles.proposalTitle, { color: c.foreground }]}>{proposal.title}</Text>
          <Text style={[styles.proposalSummary, { color: c.mutedForeground }]}>{proposal.summary}</Text>
          {!proposalConfirmed ? <Pressable accessibilityRole="button" accessibilityLabel={`Review change: ${proposal.title}`} onPress={() => onReviewProposal(proposal)} style={[styles.reviewButton, { backgroundColor: c.primary }]}><Text style={[styles.reviewText, { color: c.primaryForeground }]}>Review change</Text><Feather name="arrow-right" size={15} color={c.primaryForeground} /></Pressable> : null}
          <Text style={[styles.proposalFootnote, { color: c.mutedForeground }]}>{proposalConfirmed ? "Your plan was refreshed from the confirmed record." : "Nothing changes until you explicitly confirm."}</Text>
        </View>
      ) : null}
      {followUps.length ? (
        <View style={styles.followUps}>
          <Text style={[styles.followUpLabel, { color: c.mutedForeground }]}>You can ask next</Text>
          {followUps.slice(0, 3).map(question => <Pressable key={question} accessibilityRole="button" onPress={() => onFollowUp(question)} style={[styles.followUp, { backgroundColor: c.primary + "10", borderColor: c.primary + "35" }]}><Text style={[styles.followUpText, { color: c.primary }]}>{question}</Text><Feather name="arrow-up-right" size={13} color={c.primary} /></Pressable>)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular" },
  caveat: { minHeight: 44, marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  caveatText: { flex: 1, fontSize: 10, lineHeight: 15, fontFamily: "Inter_700Bold" },
  grounding: { marginTop: 12, borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  groundingHeader: { minHeight: 50, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  groundingCopy: { flex: 1 },
  groundingTitle: { fontSize: 11, fontFamily: "Inter_700Bold" },
  groundingMeta: { fontSize: 9, lineHeight: 13, marginTop: 2, fontFamily: "Inter_500Medium" },
  evidenceList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(148,163,184,0.22)", padding: 8, gap: 6 },
  source: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  sourceIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sourceCopy: { flex: 1 },
  sourceLabel: { fontSize: 10, fontFamily: "Inter_700Bold" },
  sourceMeta: { fontSize: 8, marginTop: 2, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  noSources: { padding: 7, fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium" },
  proposal: { marginTop: 12, borderWidth: 1, borderRadius: 15, padding: 12 },
  proposalEyebrow: { fontSize: 8, letterSpacing: 1, fontFamily: "Inter_800ExtraBold" },
  proposalTitle: { fontSize: 13, marginTop: 4, fontFamily: "Inter_800ExtraBold" },
  proposalSummary: { fontSize: 11, lineHeight: 16, marginTop: 7, fontFamily: "Inter_500Medium" },
  reviewButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 13, marginTop: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  reviewText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  proposalFootnote: { fontSize: 9, textAlign: "center", marginTop: 7, fontFamily: "Inter_500Medium" },
  followUps: { marginTop: 12, gap: 6 },
  followUpLabel: { fontSize: 9, letterSpacing: 0.7, textTransform: "uppercase", fontFamily: "Inter_800ExtraBold" },
  followUp: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  followUpText: { flex: 1, fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold" },
});

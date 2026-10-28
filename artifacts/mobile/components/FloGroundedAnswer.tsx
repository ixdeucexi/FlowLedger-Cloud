import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { floAnswerAsOf, floFreshnessLabel, floSourceDescription, safeFloSourceRoute, type FloEvidenceRef, type FloReviewProposal } from "@/lib/floExperience";

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
  const [allSourcesOpen, setAllSourcesOpen] = useState(false);
  const freshnessAsOf = floAnswerAsOf(dataAsOf, sources);
  const sourceDateSummary = sources.length > 1 ? "Dates shown per source" : sources.length === 1 ? floSourceDescription(sources[0]) : freshnessAsOf ? floFreshnessLabel(freshnessAsOf) : "Freshness unavailable";

  return (
    <View>
      <Text style={[styles.answer, { color: c.foreground }]}>{text}</Text>
      {sources.length || freshnessAsOf || partial || coverage || caveat ? (
        <View style={[styles.grounding, { borderColor: c.border, backgroundColor: c.muted + "50" }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: evidenceOpen }} accessibilityLabel="Sources and details" onPress={() => { setEvidenceOpen(open => !open); setAllSourcesOpen(false); }} style={styles.groundingHeader}>
            <Feather name="layers" size={14} color={c.mutedForeground} />
            <View style={styles.groundingCopy}>
              <Text style={[styles.groundingTitle, { color: c.foreground }]}>{"Sources & details"}{sources.length ? ` · ${sources.length}` : ""}</Text>
            </View>
            <Feather name={evidenceOpen ? "chevron-up" : "chevron-down"} size={16} color={c.mutedForeground} />
          </Pressable>
          {evidenceOpen ? (
            <View style={styles.evidenceList}>
              <Text style={[styles.groundingMeta, { color: c.mutedForeground }]}>{sourceDateSummary}{coverage ? ` · ${coverage}` : ""}</Text>
              {caveat && !text.toLocaleLowerCase().includes(caveat.trim().toLocaleLowerCase()) ? <Text style={[styles.caveatText, { color: c.mutedForeground }]}>{caveat}</Text> : null}
              {(allSourcesOpen ? sources : sources.slice(0, 3)).map((source, index) => {
                const route = safeFloSourceRoute(source.route);
                const key = source.id ?? `${source.type}-${source.recordId ?? source.label}-${index}`;
                const body = (
                  <>
                    <View style={[styles.sourceIcon, { backgroundColor: c.primary + "16" }]}><Feather name="database" size={12} color={c.primary} /></View>
                    <View style={styles.sourceCopy}><Text style={[styles.sourceLabel, { color: c.foreground }]}>{source.label}</Text><Text style={[styles.sourceMeta, { color: c.mutedForeground }]}>{floSourceDescription(source)}</Text></View>
                    {route ? <Feather name="arrow-up-right" size={14} color={c.primary} /> : null}
                  </>
                );
                return route ? (
                  <Pressable
                    key={key}
                    {...(Platform.OS === "web" ? { href: route.replace(/^\/\(tabs\)(?=\/|$)/, "") || "/" } : {})}
                    accessibilityRole="link"
                    accessibilityLabel={`Open source ${source.label}`}
                    onPress={event => {
                      if (Platform.OS === "web") {
                        const modifiers = event.nativeEvent as unknown as { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
                        if (modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey || modifiers.altKey) return;
                        event.preventDefault();
                      }
                      onOpenSource(route);
                    }}
                    style={[styles.source, { borderColor: c.border }]}
                  >{body}</Pressable>
                ) : <View key={key} style={[styles.source, { borderColor: c.border }]}>{body}</View>;
              })}
              {sources.length > 3 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: allSourcesOpen }} onPress={() => setAllSourcesOpen(open => !open)} style={styles.sourceToggle}><Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{allSourcesOpen ? "Show fewer sources" : `View all ${sources.length} sources`}</Text></Pressable> : null}
              {!sources.length ? <Text style={[styles.noSources, { color: c.mutedForeground }]}>No linked records for this answer.</Text> : null}
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
  caveatText: { paddingHorizontal: 11, paddingBottom: 10, fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  sourceToggle: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  grounding: { marginTop: 12, borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  groundingHeader: { minHeight: 50, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  groundingCopy: { flex: 1 },
  groundingTitle: { fontSize: 11, fontFamily: "Inter_700Bold" },
  groundingMeta: { fontSize: 11, lineHeight: 16, marginTop: 2, fontFamily: "Inter_500Medium" },
  evidenceList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(148,163,184,0.22)", padding: 8, gap: 6 },
  source: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  sourceIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sourceCopy: { flex: 1 },
  sourceLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sourceMeta: { fontSize: 10, lineHeight: 15, marginTop: 2, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  noSources: { padding: 7, fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium" },
  proposal: { marginTop: 12, borderWidth: 1, borderRadius: 15, padding: 12 },
  proposalEyebrow: { fontSize: 8, letterSpacing: 1, fontFamily: "Inter_800ExtraBold" },
  proposalTitle: { fontSize: 13, marginTop: 4, fontFamily: "Inter_800ExtraBold" },
  proposalSummary: { fontSize: 11, lineHeight: 16, marginTop: 7, fontFamily: "Inter_500Medium" },
  reviewButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 13, marginTop: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  reviewText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  proposalFootnote: { fontSize: 9, textAlign: "center", marginTop: 7, fontFamily: "Inter_500Medium" },
  followUps: { marginTop: 12, gap: 6 },
  followUpLabel: { fontSize: 11, letterSpacing: 0.3, fontFamily: "Inter_800ExtraBold" },
  followUp: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  followUpText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
});

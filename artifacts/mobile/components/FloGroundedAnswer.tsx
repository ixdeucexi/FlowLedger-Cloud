import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Platform, StyleSheet, type TextStyle } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { FloEvidenceRef, FloReviewProposal } from "@/lib/floExperience";
import { moneyTextSegments } from "@/lib/moneyPrivacy";

// Keep the sign with its amount while preserving the answer's original spacing.
const atomicMoneyStyle: TextStyle & { whiteSpace: "pre" } = { whiteSpace: "pre" };

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

export function FloGroundedAnswer({ text, followUps = [], proposal, proposalConfirmed, onFollowUp, onReviewProposal }: Props) {
  const c = useColors();

  return (
    <View>
      <Text style={[styles.answer, { color: c.foreground }]}>{moneyTextSegments(text).map((segment, index) => segment.kind === "money" ? <Text key={index} style={Platform.OS === "web" ? atomicMoneyStyle : undefined}>{segment.text}</Text> : segment.text)}</Text>
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

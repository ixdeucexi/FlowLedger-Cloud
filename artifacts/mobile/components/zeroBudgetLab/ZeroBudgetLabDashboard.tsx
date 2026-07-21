import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  ZERO_BUDGET_LAB_BILLS,
  ZERO_BUDGET_LAB_CHECKING_BALANCE,
  summarizeZeroBudget,
  zeroBudgetLabBillPaid,
  zeroBudgetLabFlowScore,
  type ZeroBudgetLabState,
} from "@/lib/zeroBudgetLab";

interface ZeroBudgetLabDashboardProps {
  state: ZeroBudgetLabState;
  bottomInset: number;
  onOpenBills: () => void;
  onOpenBudget: () => void;
}

export function ZeroBudgetLabDashboard({
  state,
  bottomInset,
  onOpenBills,
  onOpenBudget,
}: ZeroBudgetLabDashboardProps) {
  const c = useColors();
  const summary = summarizeZeroBudget(state);
  const score = zeroBudgetLabFlowScore(state);
  const reviewCount = state.transactions.filter(
    (transaction) =>
      transaction.date.startsWith(state.selectedMonth) &&
      transaction.status === "needs_review",
  ).length;
  const nextBill = ZERO_BUDGET_LAB_BILLS.map((bill) => ({
    bill,
    left: Math.max(0, bill.amount - zeroBudgetLabBillPaid(state, bill)),
  }))
    .filter((item) => item.left > 0.005)
    .sort((left, right) => left.bill.dueDay - right.bill.dueDay)[0];
  const underfunded = ZERO_BUDGET_LAB_BILLS.filter((bill) => {
    const category = summary.categories.find(
      (row) => row.category.id === bill.categoryId,
    );
    return (category?.assigned ?? 0) + 0.005 < bill.amount;
  });

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: bottomInset + 112 },
      ]}
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <Text style={[styles.greeting, { color: c.foreground }]}>
          Your sample money
        </Text>
        <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>
          CHECKING BALANCE
        </Text>
        <Text style={[styles.balance, { color: c.foreground }]}>
          $
          {ZERO_BUDGET_LAB_CHECKING_BALANCE.toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </Text>
        <View style={[styles.stage, { backgroundColor: c.muted }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>
              CURRENT STAGE
            </Text>
            <Text style={[styles.stageTitle, { color: c.foreground }]}>
              {underfunded.length ? "Fund the plan" : "Protect the plan"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open sample budget"
            onPress={onOpenBudget}
            style={[styles.actionPill, { backgroundColor: c.primary + "20" }]}
          >
            <Feather name="pie-chart" size={14} color={c.primary} />
            <Text style={[styles.actionText, { color: c.primary }]}>
              Budget
            </Text>
          </Pressable>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreRing, { borderColor: c.success }]}>
            <Text style={[styles.score, { color: c.foreground }]}>{score}</Text>
            <Text style={[styles.scoreLabel, { color: c.mutedForeground }]}>
              FLOW SCORE
            </Text>
          </View>
          <View style={styles.scoreCopy}>
            <Text style={[styles.scoreHeading, { color: c.success }]}>
              {score >= 80
                ? "Strong"
                : score >= 65
                  ? "Stable"
                  : "Needs attention"}
            </Text>
            <Text
              style={[styles.scoreDescription, { color: c.mutedForeground }]}
            >
              Sample algorithms use funded bills, category pressure, and
              transactions waiting for review.
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.pathCard,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.cardHeader}>
          <View
            style={[styles.cardIcon, { backgroundColor: c.warning + "18" }]}
          >
            <Feather name="shield" size={19} color={c.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: c.primary }]}>
              YOUR STABILITY PATH
            </Text>
            <Text style={[styles.cardTitle, { color: c.foreground }]}>
              {underfunded.length
                ? "Finish funding required bills"
                : "Keep every dollar protected"}
            </Text>
          </View>
        </View>
        <Text style={[styles.pathHeadline, { color: c.foreground }]}>
          {nextBill
            ? `${nextBill.bill.name} still needs $${nextBill.left.toFixed(2)}.`
            : "Every sample bill is covered."}
        </Text>
        <Text style={[styles.body, { color: c.mutedForeground }]}>
          {underfunded.length
            ? `${underfunded.length} required bill${underfunded.length === 1 ? "" : "s"} need more assigned money. Fund those before adding more to wants.`
            : "The required part of this sample plan is funded. Review new spending to keep it accurate."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenBills}
          style={[styles.primaryButton, { backgroundColor: c.primary }]}
        >
          <Feather name="file-text" size={16} color={c.primaryForeground} />
          <Text style={[styles.primaryText, { color: c.primaryForeground }]}>
            Open sample bills
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onOpenBudget}
        style={[
          styles.reviewCard,
          {
            backgroundColor: c.card,
            borderColor: reviewCount ? c.warning : c.border,
          },
        ]}
      >
        <View
          style={[
            styles.cardIcon,
            { backgroundColor: (reviewCount ? c.warning : c.success) + "18" },
          ]}
        >
          <Feather
            name={reviewCount ? "inbox" : "check-circle"}
            size={19}
            color={reviewCount ? c.warning : c.success}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.reviewTitle, { color: c.foreground }]}>
            {reviewCount
              ? `${reviewCount} fake transactions need categories`
              : "Fake activity is caught up"}
          </Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            {reviewCount
              ? "Review them in Budget to update category availability."
              : "Posted sample activity has been assigned."}
          </Text>
        </View>
        <Feather name="chevron-right" size={19} color={c.primary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  hero: { borderWidth: 1, borderRadius: 26, padding: 18 },
  greeting: {
    fontSize: 21,
    fontFamily: "Inter_800ExtraBold",
    marginBottom: 12,
  },
  eyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  balance: {
    fontSize: 38,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.3,
    marginTop: 2,
  },
  stage: {
    minHeight: 65,
    borderRadius: 18,
    padding: 12,
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stageTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  actionPill: {
    minHeight: 38,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  actionText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 20,
  },
  scoreRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  score: { fontSize: 32, fontFamily: "Inter_800ExtraBold" },
  scoreLabel: {
    fontSize: 8,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.8,
  },
  scoreCopy: { flex: 1 },
  scoreHeading: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  scoreDescription: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 5,
  },
  pathCard: { borderWidth: 1, borderRadius: 24, padding: 18 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", marginTop: 3 },
  pathHeadline: {
    fontSize: 24,
    fontFamily: "Inter_800ExtraBold",
    lineHeight: 30,
    marginTop: 18,
  },
  body: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 16,
    marginTop: 5,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 15,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  reviewCard: {
    borderWidth: 1,
    borderRadius: 20,
    minHeight: 82,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  reviewTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});

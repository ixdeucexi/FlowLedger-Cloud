import Feather from "@expo/vector-icons/Feather";
import React, { useMemo } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText } from "@/components/AppText";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { buildPaydayReviewPlan, paydayReviewMessage } from "@/lib/paydayReview";
import type { StabilityProgress } from "@/lib/stability";

function money(value: number) { return value.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
export function FloPlanReviewOverlay({ mode, progress, balanceAvailable, onClose }: { mode: "info" | "payday" | null; progress: StabilityProgress; balanceAvailable: boolean; onClose: () => void }) {
  const c = useColors();
  const budget = useBudget();
  // Do not build another forecast during Dashboard startup. Review is read-only and on demand.
  const review = useMemo(() => mode === "payday"
    ? buildPaydayReviewPlan(budget, new Date(), budget.settings.forecast_horizon_months, budget.settings.safety_floor)
    : null, [mode, budget]);
  const paragraphs = review ? paydayReviewMessage(review, budget.settings.safety_floor, budget.forecastConfidence.level, balanceAvailable) : [
    progress.reserveTarget > 0 ? `Backed-up days show how many days of required bills your forecast's spare money could cover. Expected paychecks are included—it isn't time you could live without income.` : "Add your required bills first so I can calculate backed-up days.",
    `At this month's tightest forecast point, you're projected to have ${money(progress.monthlyLowestBalance)}. I protect your ${money(progress.safetyFloor)} cushion, leaving ${money(progress.protectedAmount)} in spare room.`,
    progress.safeUntilPayday === true ? `Safe until ${progress.nextPaycheckLabel ?? "payday"} means your bills and cushion stay covered until your next income. You can still have 0 full backed-up days if spare room is small or money gets tighter later this month.` : progress.safeUntilPayday === false ? `You'll need ${money(progress.paydayShortfall)} more to protect your cushion before ${progress.nextPaycheckLabel ?? "payday"}.` : "I need your next paycheck date to check whether your cushion stays covered until payday.",
  ];
  return <Modal visible={mode !== null} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.header}>
          <Image source={require("@/assets/brand/flo-logo.jpg")} style={styles.logo} />
          <AppText tone="title" style={{ flex: 1, color: c.foreground }}>{mode === "payday" ? "Your payday review" : "Your stability path"}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close Flo review" onPress={onClose} style={styles.close}><Feather name="x" size={22} color={c.foreground} /></Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <AppText tone="label" style={{ color: c.primary }}>A REVIEW FROM FLO</AppText>
          {paragraphs.map((paragraph, index) => <AppText key={index} style={[styles.paragraph, { color: c.foreground }]}>{paragraph}</AppText>)}
          {review && review.forecastComplete && review.nextPaycheck && review.billsDue.length > 0 && balanceAvailable && review.billsDue.every(bill => Number.isFinite(bill.amount)) ? <View style={[styles.bills, { borderColor: c.border }]}>
            <AppText tone="title" style={{ color: c.foreground }}>Still planned before payday</AppText>
            {review.billsDue.map((bill, index) => <AppText key={`${bill.id}-${bill.dueDate}-${index}`} style={[styles.bill, { color: c.mutedForeground }]}>{bill.name} · {new Date(`${bill.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {money(bill.amount)}</AppText>)}
          </View> : null}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={[styles.continue, { backgroundColor: c.primary }]}><AppText tone="button" style={{ color: c.primaryForeground }}>Got it</AppText></Pressable>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 20 },
  card: { width: "100%", maxWidth: 540, maxHeight: "85%", borderRadius: 24, borderWidth: 1, padding: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 }, logo: { width: 44, height: 44, borderRadius: 22 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { flexShrink: 1 }, content: { paddingTop: 18, paddingBottom: 8, gap: 14 }, paragraph: { fontSize: 15, lineHeight: 23 },
  bills: { borderTopWidth: 1, paddingTop: 14, gap: 9 }, bill: { fontSize: 14, lineHeight: 21 },
  continue: { minHeight: 48, borderRadius: 14, marginTop: 14, alignItems: "center", justifyContent: "center" },
});

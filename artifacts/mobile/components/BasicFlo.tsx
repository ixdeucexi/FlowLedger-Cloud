import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import type { DecisionBaselineDay } from "@/lib/decisions";
import { humanizeFloText } from "@/lib/floLanguage";
import { localFloAnswer, type FloFacts } from "@/lib/floPolicy";
import { PLAN_CATALOG, annualMonthlyEquivalent } from "@/lib/membership";

interface BasicPrompt {
  id: string;
  title: string;
  prompt: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  route: string;
  requiresAmount?: boolean;
}

const BASIC_PROMPTS: readonly BasicPrompt[] = [
  { id: "snapshot", title: "Money snapshot", prompt: "Give me my money snapshot", icon: "activity", route: "/(tabs)" },
  { id: "bills", title: "Bills due next", prompt: "Which bills are due next?", icon: "calendar", route: "/(tabs)/bills" },
  { id: "low", title: "Why balance gets low", prompt: "Why is my balance getting low?", icon: "trending-down", route: "/(tabs)/monthly" },
  { id: "remaining", title: "Money left this month", prompt: "How much money is left this month?", icon: "dollar-sign", route: "/(tabs)/monthly" },
  { id: "categories", title: "Categories needing attention", prompt: "Which categories need attention?", icon: "pie-chart", route: "/(tabs)/category-budget" },
  { id: "debt", title: "Debt balance snapshot", prompt: "Show my debt balance snapshot", icon: "credit-card", route: "/(tabs)/bills" },
  { id: "afford", title: "Can I afford this?", prompt: "Can I afford", icon: "shopping-bag", route: "/(tabs)/monthly", requiresAmount: true },
  { id: "add-bill", title: "Help adding a bill", prompt: "How do I add a bill?", icon: "plus-circle", route: "/(tabs)/bills" },
  { id: "add-income", title: "Help adding income", prompt: "How do I add income?", icon: "arrow-down-circle", route: "/(tabs)/more" },
  { id: "add-transaction", title: "Help adding a transaction", prompt: "How do I add a transaction?", icon: "list", route: "/(tabs)/transactions" },
  { id: "add-account", title: "Help adding an account", prompt: "How do I add an account?", icon: "briefcase", route: "/(tabs)/more" },
  { id: "add-goal", title: "Help adding a goal", prompt: "How do I add a goal?", icon: "target", route: "/(tabs)/more" },
] as const;

const HELP_ANSWERS: Record<string, string> = {
  "add-bill": "Open Bills, tap Add bill, enter the details, and save.",
  "add-income": "Open More, choose Income, and add the pay details.",
  "add-transaction": "Open Activity, tap Add transaction, and enter the details.",
  "add-account": "Open More, choose Accounts, and add an account.",
  "add-goal": "Open More, choose Goals, and add the target.",
};

export function BasicFlo({ facts, baseline, asOf }: { facts: FloFacts; baseline: DecisionBaselineDay[]; asOf: string }) {
  const c = useColors();
  const router = useRouter();
  const { isAdmin, previewTier, bypassFeature } = useMembership();
  const [amount, setAmount] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const selected = useMemo(() => BASIC_PROMPTS.find(prompt => prompt.id === selectedId) ?? null, [selectedId]);

  const runPrompt = (prompt: BasicPrompt) => {
    setSelectedId(prompt.id);
    if (prompt.requiresAmount) {
      const parsed = Number(amount.replace(/[$,]/g, ""));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setAnswer("Enter the amount first.");
        return;
      }
      setAnswer(humanizeFloText(localFloAnswer(`Can I afford $${parsed.toFixed(2)}?`, facts, baseline) ?? "Add your balance, income, and bills so I can check it."));
      return;
    }
    setAnswer(humanizeFloText(HELP_ANSWERS[prompt.id] ?? localFloAnswer(prompt.prompt, facts, baseline) ?? "Open the related screen to review it."));
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderColor: c.border, backgroundColor: c.card }]}>
        <FloLogo size={46} />
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: c.foreground }]}>Basic Flo</Text>
          <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Guided answers from your FlowLedger calculations. No AI usage.</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.asOf, { color: c.mutedForeground }]}>Data as of {new Date(asOf).toLocaleString()}</Text>
        <View style={styles.grid}>
          {BASIC_PROMPTS.map(prompt => (
            <Pressable
              key={prompt.id}
              accessibilityRole="button"
              accessibilityLabel={prompt.title}
              onPress={() => runPrompt(prompt)}
              style={({ pressed }) => [styles.prompt, { backgroundColor: c.card, borderColor: selectedId === prompt.id ? c.primary : c.border, opacity: pressed ? 0.75 : 1 }]}
            >
              <Feather name={prompt.icon} size={18} color={c.primary} />
              <Text style={[styles.promptText, { color: c.foreground }]}>{prompt.title}</Text>
            </Pressable>
          ))}
        </View>

        {selected?.requiresAmount ? (
          <View style={[styles.amountRow, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.amountPrefix, { color: c.mutedForeground }]}>$</Text>
            <TextInput
              accessibilityLabel="Purchase amount"
              value={amount}
              onChangeText={setAmount}
              onSubmitEditing={() => runPrompt(selected)}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={c.mutedForeground}
              style={[styles.amountInput, { color: c.foreground }]}
            />
            <Pressable accessibilityRole="button" onPress={() => runPrompt(selected)} style={[styles.checkButton, { backgroundColor: c.primary }]}>
              <Text style={[styles.checkText, { color: c.primaryForeground }]}>Check</Text>
            </Pressable>
          </View>
        ) : null}

        {answer ? (
          <View style={[styles.answer, { backgroundColor: c.card, borderColor: c.primary + "55" }]}>
            <Text style={[styles.answerTitle, { color: c.primary }]}>Basic Flo answer</Text>
            <Text style={[styles.answerText, { color: c.foreground }]}>{answer}</Text>
            {selected ? (
              <Pressable accessibilityRole="button" onPress={() => router.push(selected.route as never)} style={[styles.openButton, { backgroundColor: c.primary + "16" }]}>
                <Text style={[styles.openText, { color: c.primary }]}>Open related screen</Text>
                <Feather name="arrow-right" size={15} color={c.primary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.proCard, { backgroundColor: c.primary + "12", borderColor: c.primary + "55" }]}>
          <Text style={[styles.proEyebrow, { color: c.primary }]}>FLO PRO</Text>
          <Text style={[styles.proTitle, { color: c.foreground }]}>Free-form, account-aware chat</Text>
          <Text style={[styles.proText, { color: c.mutedForeground }]}>Ask follow-up questions, search live household records, save private chats, and confirm supported money moves. {PLAN_CATALOG.pro.name} is ${annualMonthlyEquivalent("pro").toFixed(2)}/month when billed annually.</Text>
          {isAdmin && previewTier === "free" ? (
            <Pressable accessibilityRole="button" onPress={() => bypassFeature("flo_account_chat")} style={[styles.adminButton, { backgroundColor: c.primary }]}>
              <Feather name="unlock" size={15} color={c.primaryForeground} />
              <Text style={[styles.adminText, { color: c.primaryForeground }]}>Admin bypass Flo Pro</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1 },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontFamily: "Inter_800ExtraBold" },
  subtitle: { marginTop: 3, fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  content: { padding: 16, paddingBottom: 120, gap: 14 },
  asOf: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  prompt: { width: "48%", minHeight: 76, borderWidth: 1, borderRadius: 16, padding: 14, justifyContent: "space-between", gap: 8 },
  promptText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_700Bold" },
  amountRow: { minHeight: 58, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 16, paddingLeft: 14, overflow: "hidden" },
  amountPrefix: { fontSize: 17, fontFamily: "Inter_700Bold" },
  amountInput: { flex: 1, minHeight: 56, paddingHorizontal: 6, fontSize: 18, fontFamily: "Inter_700Bold" },
  checkButton: { alignSelf: "stretch", justifyContent: "center", paddingHorizontal: 20 },
  checkText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  answer: { borderWidth: 1, borderRadius: 18, padding: 16 },
  answerTitle: { fontSize: 11, letterSpacing: 0.7, fontFamily: "Inter_800ExtraBold" },
  answerText: { marginTop: 8, fontSize: 14, lineHeight: 21, fontFamily: "Inter_500Medium" },
  openButton: { marginTop: 14, minHeight: 44, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  openText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  proCard: { borderWidth: 1, borderRadius: 20, padding: 18 },
  proEyebrow: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_800ExtraBold" },
  proTitle: { marginTop: 6, fontSize: 19, fontFamily: "Inter_800ExtraBold" },
  proText: { marginTop: 8, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  adminButton: { marginTop: 14, minHeight: 44, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  adminText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

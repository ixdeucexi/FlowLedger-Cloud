import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";

const CONTEXT_BY_PATH: Record<string, { label: string; prompt: string; entityType: string }> = {
  "/": { label: "Ask about my plan", prompt: "What should I know about my plan today?", entityType: "dashboard" },
  "/(tabs)": { label: "Ask about my plan", prompt: "What should I know about my plan today?", entityType: "dashboard" },
  "/(tabs)/bills": { label: "Ask about debts & bills", prompt: "What should I know about my bills and debts?", entityType: "bills" },
  "/bills": { label: "Ask about debts & bills", prompt: "What should I know about my bills and debts?", entityType: "bills" },
  "/(tabs)/transactions": { label: "Ask about activity", prompt: "What should I know about my recent activity?", entityType: "transactions" },
  "/transactions": { label: "Ask about activity", prompt: "What should I know about my recent activity?", entityType: "transactions" },
  "/(tabs)/monthly": { label: "Ask about my forecast", prompt: "What should I know about my forecast?", entityType: "forecast" },
  "/monthly": { label: "Ask about my forecast", prompt: "What should I know about my forecast?", entityType: "forecast" },
  "/(tabs)/category-budget": { label: "Ask about categories", prompt: "What should I know about my category plan?", entityType: "categories" },
  "/category-budget": { label: "Ask about categories", prompt: "What should I know about my category plan?", entityType: "categories" },
  "/snowball-plan": { label: "Ask about payoff", prompt: "What should I know about my debt payoff plan?", entityType: "debt_plan" },
  "/planned-debt-payment": { label: "Ask about this payment", prompt: "Help me understand this planned debt payment.", entityType: "debt_payment" },
  "/plan-simulator": { label: "Ask about this scenario", prompt: "Help me understand my current simulation.", entityType: "simulation" },
};

export function FloLauncher({ desktop }: { desktop: boolean }) {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const { isFeatureLocked } = useMembership();
  if (isFeatureLocked("flo_account_chat") || pathname.endsWith("/flo")) return null;
  const context = CONTEXT_BY_PATH[pathname] ?? { label: "Ask Flo", prompt: "What should I know about my account?", entityType: "account" };
  return (
    <View pointerEvents="box-none" style={[styles.slot, desktop ? styles.slotDesktop : styles.slotMobile]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={context.label}
        onPress={() => router.push({ pathname: "/(tabs)/flo", params: { prompt: context.prompt, promptId: `context-${Date.now()}`, sourceRoute: pathname, entityType: context.entityType } } as never)}
        style={({ pressed }) => [styles.button, desktop && styles.buttonDesktop, { backgroundColor: c.card, borderColor: c.primary + "70", opacity: pressed ? 0.78 : 1 }]}
      >
        <FloLogo size={desktop ? 30 : 34} />
        {desktop ? <Text style={[styles.label, { color: c.foreground }]}>{context.label}</Text> : null}
        {desktop ? <Feather name="arrow-up-right" size={15} color={c.primary} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", zIndex: 35 },
  slotMobile: { right: 16, bottom: 98 },
  slotDesktop: { right: 24, bottom: 24 },
  button: { minWidth: 54, minHeight: 54, borderRadius: 27, borderWidth: 1, alignItems: "center", justifyContent: "center", shadowColor: "#7c3aed", shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  buttonDesktop: { minWidth: 170, minHeight: 48, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", gap: 8 },
  label: { flex: 1, fontSize: 11, fontFamily: "Inter_800ExtraBold" },
});

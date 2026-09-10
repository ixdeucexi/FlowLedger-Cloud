import Feather from "@expo/vector-icons/Feather";
import { usePathname, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloLogo } from "@/components/FloLogo";
import { useMembership } from "@/context/MembershipContext";
import { useColors } from "@/hooks/useColors";
import { useFloLauncherPreference } from "@/hooks/useFloLauncherPreference";
import * as Haptics from "@/lib/haptics";

const UNDO_DURATION_MS = 5000;

const CONTEXT_BY_PATH: Record<
  string,
  { label: string; prompt: string; entityType: string }
> = {
  "/": {
    label: "Ask about my plan",
    prompt: "What should I know about my plan today?",
    entityType: "dashboard",
  },
  "/(tabs)": {
    label: "Ask about my plan",
    prompt: "What should I know about my plan today?",
    entityType: "dashboard",
  },
  "/(tabs)/bills": {
    label: "Ask about debts & bills",
    prompt: "What should I know about my bills and debts?",
    entityType: "bills",
  },
  "/bills": {
    label: "Ask about debts & bills",
    prompt: "What should I know about my bills and debts?",
    entityType: "bills",
  },
  "/(tabs)/transactions": {
    label: "Ask about activity",
    prompt: "What should I know about my recent activity?",
    entityType: "transactions",
  },
  "/transactions": {
    label: "Ask about activity",
    prompt: "What should I know about my recent activity?",
    entityType: "transactions",
  },
  "/(tabs)/monthly": {
    label: "Ask about my forecast",
    prompt: "What should I know about my forecast?",
    entityType: "forecast",
  },
  "/monthly": {
    label: "Ask about my forecast",
    prompt: "What should I know about my forecast?",
    entityType: "forecast",
  },
  "/(tabs)/category-budget": {
    label: "Ask about categories",
    prompt: "What should I know about my category plan?",
    entityType: "categories",
  },
  "/category-budget": {
    label: "Ask about categories",
    prompt: "What should I know about my category plan?",
    entityType: "categories",
  },
  "/snowball-plan": {
    label: "Ask about payoff",
    prompt: "What should I know about my debt payoff plan?",
    entityType: "debt_plan",
  },
  "/planned-debt-payment": {
    label: "Ask about this payment",
    prompt: "Help me understand this planned debt payment.",
    entityType: "debt_payment",
  },
  "/plan-simulator": {
    label: "Ask about this scenario",
    prompt: "Help me understand my current simulation.",
    entityType: "simulation",
  },
};

export function FloLauncher({ desktop }: { desktop: boolean }) {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isFeatureLocked } = useMembership();
  const preference = useFloLauncherPreference();
  const currentScope = useRef(preference.scope);
  currentScope.current = preference.scope;
  const held = useRef(false);
  const [undoScope, setUndoScope] = useState<typeof preference.scope | null>(
    null,
  );
  const showUndo = undoScope === preference.scope && !preference.enabled;
  useEffect(() => {
    if (!undoScope) return;
    const timer = setTimeout(() => setUndoScope(null), UNDO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [undoScope]);

  if (
    !preference.ready ||
    isFeatureLocked("flo_account_chat") ||
    pathname.endsWith("/flo") ||
    (!preference.enabled && !showUndo)
  )
    return null;
  const context = CONTEXT_BY_PATH[pathname] ?? {
    label: "Ask Flo",
    prompt: "What should I know about my account?",
    entityType: "account",
  };
  const saveVisibility = async (enabled: boolean) => {
    const scope = preference.scope;
    const saved = await preference.setEnabled(enabled);
    if (scope !== currentScope.current) return;
    if (!saved) {
      Alert.alert(
        "Flo shortcut",
        "Couldn't save this change. Your previous setting is unchanged. Please try again.",
      );
      return;
    }
    setUndoScope(enabled ? null : scope);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.slot,
        {
          right: (desktop ? 24 : 16) + insets.right,
          bottom: (desktop ? 24 : 98) + insets.bottom,
        },
      ]}
    >
      {preference.error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: c.foreground,
            backgroundColor: c.card,
            maxWidth: 220,
            padding: 8,
          }}
        >
          {preference.error}
        </Text>
      ) : null}
      {showUndo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo hiding the Flo shortcut"
          disabled={preference.saving}
          onPress={() => {
            void saveVisibility(true);
          }}
          style={[
            styles.undoButton,
            { backgroundColor: c.card, borderColor: c.primary + "70" },
          ]}
        >
          <Feather name="eye-off" size={16} color={c.mutedForeground} />
          <Text style={{ color: c.mutedForeground }}>Flo hidden</Text>
          <Text style={{ color: c.primary, fontFamily: "Inter_700Bold" }}>
            {preference.saving ? "Saving…" : "Undo"}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={context.label}
          accessibilityHint="Tap to open Flo. Hold to hide this shortcut. Turn it back on in Settings or Customize Dashboard."
          delayLongPress={650}
          disabled={preference.saving}
          onPressIn={() => {
            held.current = false;
          }}
          onLongPress={() => {
            held.current = true;
            void saveVisibility(false);
          }}
          onPress={() => {
            if (held.current) return;
            router.push({
              pathname: "/(tabs)/flo",
              params: {
                prompt: context.prompt,
                promptId: `context-${Date.now()}`,
                sourceRoute: pathname,
                entityType: context.entityType,
              },
            } as never);
          }}
          style={({ pressed }) => [
            styles.button,
            desktop && styles.buttonDesktop,
            {
              backgroundColor: c.card,
              borderColor: c.primary + "70",
              opacity: pressed || preference.saving ? 0.7 : 1,
            },
          ]}
        >
          <FloLogo size={desktop ? 30 : 34} />
          {desktop ? (
            <Text style={[styles.label, { color: c.foreground }]}>
              {context.label}
            </Text>
          ) : null}
          {desktop ? (
            <Feather name="arrow-up-right" size={15} color={c.primary} />
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", zIndex: 35 },
  button: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  buttonDesktop: {
    width: 188,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: "row",
    gap: 8,
  },
  label: { flex: 1, fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  undoButton: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});

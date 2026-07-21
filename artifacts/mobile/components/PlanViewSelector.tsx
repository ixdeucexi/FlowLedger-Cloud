import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";

import { FloLogo } from "@/components/FloLogo";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

interface PlanViewSelectorProps {
  textStyle?: StyleProp<TextStyle>;
}

export function PlanViewSelector({ textStyle }: PlanViewSelectorProps) {
  const c = useColors();
  const { user } = useAuth();
  const { settings, updateSettings, activeHousehold, canEditHousehold } = useBudget();
  const [visible, setVisible] = useState(false);
  const [showFloIntro, setShowFloIntro] = useState(false);
  const [hasSeenIntro, setHasSeenIntro] = useState(false);
  const [switching, setSwitching] = useState(false);
  const zeroBudgetEnabled = settings.zeroBasedBudgetEnabled;
  const storageKey = useMemo(
    () => `flowledger_zero_budget_view_intro_${activeHousehold?.householdId ?? user?.id ?? "guest"}`,
    [activeHousehold?.householdId, user?.id],
  );

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(storageKey).then(value => {
      if (!cancelled) setHasSeenIntro(value === "true");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [storageKey]);

  const close = () => {
    if (switching) return;
    setVisible(false);
    setShowFloIntro(false);
  };

  const applyMode = async (enabled: boolean) => {
    if (!canEditHousehold || switching || enabled === zeroBudgetEnabled) {
      if (enabled === zeroBudgetEnabled) close();
      return;
    }
    setSwitching(true);
    setVisible(false);
    setShowFloIntro(false);
    try {
      await updateSettings({ zeroBasedBudgetEnabled: enabled });
    } finally {
      setSwitching(false);
    }
  };

  const chooseZeroBudget = () => {
    if (!canEditHousehold || zeroBudgetEnabled) {
      if (zeroBudgetEnabled) close();
      return;
    }
    if (!hasSeenIntro) {
      setShowFloIntro(true);
      return;
    }
    void applyMode(true);
  };

  const confirmFloIntro = () => {
    setHasSeenIntro(true);
    void AsyncStorage.setItem(storageKey, "true").catch(() => undefined);
    void applyMode(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Plan view: ${zeroBudgetEnabled ? "Zero Budget" : "Activity"}. Tap to change.`}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.72 : 1 }]}
      >
        <Text style={[styles.triggerText, { color: c.foreground }, textStyle]}>{zeroBudgetEnabled ? "Zero Budget" : "Activity"}</Text>
        <Feather name="chevron-down" size={18} color={c.primary} />
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: c.mutedForeground }]} />
            {showFloIntro ? (
              <>
                <View style={styles.floHeader}>
                  <FloLogo size={52} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.eyebrow, { color: c.primary }]}>FLO CAN HELP</Text>
                    <Text style={[styles.sheetTitle, { color: c.foreground }]}>Try Zero Budget</Text>
                  </View>
                </View>
                <Text style={[styles.explanation, { color: c.mutedForeground }]}>Hi, I’m Flo. Zero Budget changes this tab into a place where you give every planned dollar a job. Your real income, bills, bank activity, calendar, and FlowLedger algorithms stay connected.</Text>
                <View style={[styles.preserveNote, { backgroundColor: c.success + "12", borderColor: c.success + "35" }]}>
                  <Feather name="shield" size={17} color={c.success} />
                  <Text style={[styles.preserveText, { color: c.foreground }]}>You can switch back anytime without losing your saved assignments.</Text>
                </View>
                <Pressable disabled={switching} onPress={confirmFloIntro} style={[styles.primaryButton, { backgroundColor: c.primary, opacity: switching ? 0.55 : 1 }]}>
                  <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{switching ? "Switching…" : "Use Zero Budget"}</Text>
                </Pressable>
                <Pressable onPress={() => setShowFloIntro(false)} style={styles.secondaryButton}>
                  <Text style={[styles.secondaryButtonText, { color: c.mutedForeground }]}>Back</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.eyebrow, { color: c.primary }]}>PLAN VIEW</Text>
                <Text style={[styles.sheetTitle, { color: c.foreground }]}>How do you want to work?</Text>
                <Text style={[styles.sheetSubtitle, { color: c.mutedForeground }]}>Both views use the same FlowLedger plan and real account activity.</Text>
                <PlanViewOption
                  c={c}
                  icon="repeat"
                  title="Activity"
                  description="Track what happened and see every transaction."
                  selected={!zeroBudgetEnabled}
                  disabled={!canEditHousehold}
                  onPress={() => void applyMode(false)}
                />
                <PlanViewOption
                  c={c}
                  icon="pie-chart"
                  title="Zero Budget"
                  description="Give every planned dollar a job by category."
                  selected={zeroBudgetEnabled}
                  disabled={!canEditHousehold}
                  onPress={chooseZeroBudget}
                />
                {!canEditHousehold && <Text style={[styles.permissionText, { color: c.warning }]}>Only a household editor can change the shared plan view.</Text>}
                <Pressable onPress={close} style={styles.secondaryButton}>
                  <Text style={[styles.secondaryButtonText, { color: c.mutedForeground }]}>Close</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function PlanViewOption({ c, icon, title, description, selected, disabled, onPress }: {
  c: ReturnType<typeof useColors>;
  icon: "repeat" | "pie-chart";
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: selected ? c.primary + "16" : c.background, borderColor: selected ? c.primary : c.border, opacity: disabled ? 0.5 : pressed ? 0.78 : 1 }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: selected ? c.primary + "20" : c.muted }]}>
        <Feather name={icon} size={19} color={selected ? c.primary : c.mutedForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, { color: c.foreground }]}>{title}</Text>
        <Text style={[styles.optionDescription, { color: c.mutedForeground }]}>{description}</Text>
      </View>
      <Feather name={selected ? "check-circle" : "circle"} size={21} color={selected ? c.success : c.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  triggerText: { fontSize: 28, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.68)" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, padding: 20, paddingBottom: 30, gap: 12 },
  handle: { alignSelf: "center", width: 48, height: 4, borderRadius: 999, opacity: 0.45, marginBottom: 5 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  sheetTitle: { fontSize: 23, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },
  sheetSubtitle: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18, marginBottom: 3 },
  option: { minHeight: 76, borderWidth: 1, borderRadius: 18, padding: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  optionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  optionDescription: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 3 },
  floHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 2 },
  explanation: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 21 },
  preserveNote: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  preserveText: { flex: 1, fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17 },
  primaryButton: { minHeight: 50, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 3 },
  primaryButtonText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  secondaryButton: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  permissionText: { fontSize: 12, fontFamily: "Inter_700Bold", lineHeight: 17, textAlign: "center" },
});

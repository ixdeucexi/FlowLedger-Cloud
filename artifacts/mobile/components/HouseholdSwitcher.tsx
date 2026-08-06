import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { householdRoleLabel } from "@/lib/householdPermissions";

export function HouseholdSwitcher({
  appearance = "header",
}: {
  appearance?: "header" | "settings";
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const {
    activeHousehold,
    householdRole,
    households,
    switchHousehold,
  } = useBudget();
  const [visible, setVisible] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const compact = appearance === "header" && width < 480;

  const close = useCallback(() => {
    if (switchingId) return;
    setVisible(false);
    setMessage(null);
  }, [switchingId]);
  useBackDismiss(visible, close);

  const chooseHousehold = useCallback(
    async (householdId: string) => {
      if (switchingId || activeHousehold?.householdId === householdId) return;
      setSwitchingId(householdId);
      setMessage(null);
      try {
        await switchHousehold(householdId);
        setVisible(false);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not switch households. Try again.",
        );
      } finally {
        setSwitchingId(null);
      }
    },
    [activeHousehold?.householdId, switchHousehold, switchingId],
  );

  const currentName = activeHousehold?.name ?? "Personal";
  const canSwitch = households.length > 1;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Current household: ${currentName}${canSwitch ? ". Switch household" : ""}`}
        accessibilityHint={canSwitch ? "Opens your household list" : undefined}
        onPress={() => {
          setMessage(null);
          setVisible(true);
        }}
        style={({ pressed }) => [
          appearance === "header" ? styles.headerTrigger : styles.settingsTrigger,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <View style={[styles.triggerIcon, { backgroundColor: colors.primary + "1f" }]}>
          <Feather name="users" size={appearance === "header" ? 16 : 18} color={colors.primary} />
        </View>
        {!compact ? (
          <View style={styles.triggerCopy}>
            <Text numberOfLines={1} style={[styles.triggerName, { color: colors.foreground }]}>
              {currentName}
            </Text>
            {appearance === "settings" ? (
              <Text numberOfLines={1} style={[styles.triggerMeta, { color: colors.mutedForeground }]}>
                {householdRole ? householdRoleLabel(householdRole) : "Private"}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close household switcher"
          onPress={close}
          style={styles.overlay}
        >
          <Pressable
            accessibilityViewIsModal
            onPress={() => undefined}
            style={[
              styles.sheet,
              Platform.OS === "web" && styles.webSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIcon, { backgroundColor: colors.primary + "1f" }]}>
                <Feather name="users" size={20} color={colors.primary} />
              </View>
              <View style={styles.sheetHeaderCopy}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Switch household</Text>
                <Text style={[styles.sheetDescription, { color: colors.mutedForeground }]}>Choose which FlowLedger plan and accounts you want to view.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close household switcher"
                hitSlop={8}
                onPress={close}
                style={[styles.closeButton, { backgroundColor: colors.muted }]}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.householdList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={households.length > 4}
              style={styles.householdScroller}
            >
              {households.map((household) => {
                const selected = household.householdId === activeHousehold?.householdId;
                const busy = switchingId === household.householdId;
                return (
                  <Pressable
                    key={household.householdId}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: Boolean(switchingId) }}
                    accessibilityLabel={`${household.name}, ${householdRoleLabel(household.role)}${selected ? ", selected" : ""}`}
                    disabled={Boolean(switchingId)}
                    onPress={() => void chooseHousehold(household.householdId)}
                    style={({ pressed }) => [
                      styles.householdRow,
                      {
                        backgroundColor: selected ? colors.primary + "18" : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                        opacity: pressed ? 0.76 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.householdIcon,
                        { backgroundColor: selected ? colors.primary : colors.muted },
                      ]}
                    >
                      <Feather
                        name={household.isPersonal ? "user" : "home"}
                        size={18}
                        color={selected ? colors.primaryForeground : colors.mutedForeground}
                      />
                    </View>
                    <View style={styles.householdCopy}>
                      <Text numberOfLines={1} style={[styles.householdName, { color: colors.foreground }]}>
                        {household.name}
                      </Text>
                      <Text style={[styles.householdMeta, { color: colors.mutedForeground }]}>
                        {household.isPersonal ? "Personal plan" : "Shared household"} · {householdRoleLabel(household.role)}
                      </Text>
                    </View>
                    {busy ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : selected ? (
                      <View style={[styles.selectedIcon, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={14} color={colors.primaryForeground} />
                      </View>
                    ) : (
                      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                );
              })}
              {households.length === 0 ? (
                <View style={[styles.emptyState, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Feather name="home" size={21} color={colors.mutedForeground} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No household available</Text>
                  <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>Open Accounts & household in Settings to create or join one.</Text>
                </View>
              ) : null}
            </ScrollView>

            {message ? (
              <View style={[styles.message, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "55" }]}>
                <Feather name="alert-circle" size={15} color={colors.destructive} />
                <Text style={[styles.messageText, { color: colors.destructive }]}>{message}</Text>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerTrigger: {
    minWidth: 52,
    maxWidth: 154,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  settingsTrigger: {
    minWidth: 230,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  triggerIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  triggerCopy: { flex: 1, minWidth: 0 },
  triggerName: { fontSize: 12, fontFamily: "Inter_700Bold" },
  triggerMeta: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.34,
    shadowRadius: 34,
    elevation: 20,
  },
  webSheet: { maxWidth: 540 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginBottom: 16 },
  sheetIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetHeaderCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 18, lineHeight: 23, fontFamily: "Inter_800ExtraBold" },
  sheetDescription: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },
  closeButton: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  householdList: { gap: 9 },
  householdScroller: { flexShrink: 1 },
  householdRow: { minHeight: 68, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  householdIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  householdCopy: { flex: 1, minWidth: 0 },
  householdName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  householdMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 3 },
  selectedIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  emptyState: { minHeight: 130, borderWidth: 1, borderRadius: 16, alignItems: "center", justifyContent: "center", padding: 18 },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 8 },
  emptyCopy: { maxWidth: 320, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 4 },
  message: { marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  messageText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
});

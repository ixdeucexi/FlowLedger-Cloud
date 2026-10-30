import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import { FloLauncherSetting } from "@/components/FloLauncherSetting";
import React, { useEffect } from "react";
import { Modal, Platform, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DashboardLayoutStatus } from "@/components/DashboardLayoutStatus";
import {
  DASHBOARD_FAVORITE_ACTIONS,
  DASHBOARD_LAYOUT_PRESETS,
  DASHBOARD_WIDGETS,
  MAX_DASHBOARD_FAVORITES,
  applyDashboardLayoutPreset,
  dashboardLayoutPreset,
  moveDashboardWidget,
  setDashboardWidgetVisible,
  toggleDashboardFavoriteAction,
  type DashboardLayoutPreference,
  type DashboardWidgetId,
} from "@/lib/dashboardCustomization";

type Props = {
  visible: boolean;
  layout: DashboardLayoutPreference;
  onChange: (layout: DashboardLayoutPreference) => void;
  onReset: () => void;
  onClose: () => void;
  availableWidgetIds?: readonly DashboardWidgetId[];
  loading?: boolean;
  saving?: boolean;
  saveError?: string | null;
  loadError?: string | null;
  onRetrySave?: () => void;
  onRetryLoad?: () => void;
};

export function DashboardCustomizer({ visible, layout, onChange, onReset, onClose, availableWidgetIds, loading = false, saving = false, saveError, loadError, onRetrySave, onRetryLoad }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 700;
  const reduceMotion = useReducedMotion();
  const selectedPreset = dashboardLayoutPreset(layout);
  const widgetOrder = layout.order.filter(id => !availableWidgetIds || availableWidgetIds.includes(id));
  useBackDismiss(visible, onClose);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, visible]);

  const move = (id: DashboardWidgetId, direction: "up" | "down") => {
    onChange(moveDashboardWidget(layout, id, direction, availableWidgetIds));
  };

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : compact ? "slide" : "fade"} onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close dashboard customization"
        onPress={onClose}
        style={[styles.backdrop, compact && styles.backdropCompact]}
      >
        <Pressable
          accessibilityViewIsModal
          accessibilityRole="none"
          onPress={event => event.stopPropagation()}
          style={[
            styles.dialog,
            compact && styles.dialogCompact,
            {
              backgroundColor: c.isDark ? "#090d18" : "#ffffff",
              borderColor: c.border,
              paddingBottom: compact ? Math.max(insets.bottom, 18) : 22,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Customize Dashboard</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Choose what appears and set the order for this household.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <DashboardLayoutStatus loading={loading} saving={saving} saveError={saveError} loadError={loadError} retrySave={onRetrySave} retryLoad={onRetryLoad} />
            <View style={styles.sectionHeading}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>Start with a layout</Text>
              <Text style={[styles.currentLayout, { color: c.primary }]}>Selected: {selectedPreset?.name ?? "Custom"}</Text>
            </View>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Pick a starting point, then arrange cards and pin the actions you use most.</Text>
            <View style={styles.presetList}>
              {DASHBOARD_LAYOUT_PRESETS.map(preset => {
                const selected = selectedPreset?.id === preset.id;
                return <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply ${preset.name} dashboard layout`}
                  accessibilityState={{ selected, disabled: loading }}
                  aria-pressed={selected}
                  disabled={loading}
                  onPress={() => onChange(applyDashboardLayoutPreset(preset.id))}
                  style={({ pressed }) => [styles.preset, { backgroundColor: c.card, borderColor: selected ? c.primary : c.border, borderWidth: selected ? 2 : 1, opacity: loading ? 0.5 : pressed ? 0.78 : 1 }]}
                >
                  <View style={styles.presetHeading}><Text style={[styles.presetTitle, { color: c.foreground }]}>{preset.name}</Text>{selected ? <Feather name="check-circle" size={18} color={c.primary} /> : null}</View>
                  <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>{preset.description}</Text>
                </Pressable>;
              })}
            </View>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>Arrange your cards</Text>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Use the arrows to move cards. Hide optional cards without changing your plan.</Text>
            <FloLauncherSetting />
            {widgetOrder.map((id, index) => {
              const widget = DASHBOARD_WIDGETS[id];
              const visibleWidget = !layout.hidden.includes(id);
              return (
                <View key={id} style={[styles.row, { borderColor: c.border, backgroundColor: c.card }]}>
                  <View style={[styles.dragIcon, { backgroundColor: c.primary + "18" }]}>
                    <Feather name="move" size={17} color={c.primary} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: c.foreground }]}>{widget.label}</Text>
                    <Text style={[styles.rowDescription, { color: c.mutedForeground }]}>{widget.description}</Text>
                    {widget.required ? <Text style={[styles.required, { color: c.primary }]}>Required</Text> : null}
                  </View>
                  <View style={styles.rowActions}>
                    <View style={styles.moveActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${widget.label} up`}
                        accessibilityState={{ disabled: loading || index === 0 }}
                        disabled={loading || index === 0}
                        onPress={() => move(id, "up")}
                        style={[styles.smallButton, { borderColor: c.border, opacity: index === 0 ? 0.35 : 1 }]}
                      >
                        <Feather name="arrow-up" size={16} color={c.foreground} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${widget.label} down`}
                        accessibilityState={{ disabled: loading || index === widgetOrder.length - 1 }}
                        disabled={loading || index === widgetOrder.length - 1}
                        onPress={() => move(id, "down")}
                        style={[styles.smallButton, { borderColor: c.border, opacity: index === widgetOrder.length - 1 ? 0.35 : 1 }]}
                      >
                        <Feather name="arrow-down" size={16} color={c.foreground} />
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityLabel={`${visibleWidget ? "Hide" : "Show"} ${widget.label}`}
                      accessibilityState={{ checked: visibleWidget, disabled: loading || Boolean(widget.required) }}
                      disabled={loading || widget.required}
                      onPress={() => onChange(setDashboardWidgetVisible(layout, id, !visibleWidget))}
                      style={[
                        styles.switch,
                        { backgroundColor: visibleWidget ? c.primary : c.muted, opacity: widget.required ? 0.62 : 1 },
                      ]}
                    >
                      <View style={[styles.switchThumb, visibleWidget && styles.switchThumbOn]} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <View style={styles.sectionHeading}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>Favorite actions</Text>
              <Text style={[styles.currentLayout, { color: c.mutedForeground }]}>{layout.favoriteActions.length}/{MAX_DASHBOARD_FAVORITES} pinned</Text>
            </View>
            <Text style={[styles.sectionCopy, { color: c.mutedForeground }]}>Pin up to four shortcuts to your Favorite actions card.</Text>
            {DASHBOARD_FAVORITE_ACTIONS.map(command => {
              const pinned = layout.favoriteActions.includes(command.id);
              const disabled = loading || (!pinned && layout.favoriteActions.length >= MAX_DASHBOARD_FAVORITES);
              return <Pressable
                key={command.id}
                accessibilityRole="checkbox"
                accessibilityLabel={`${pinned ? "Unpin" : "Pin"} ${command.title}`}
                accessibilityState={{ checked: pinned, disabled }}
                disabled={disabled}
                onPress={() => onChange(toggleDashboardFavoriteAction(layout, command.id))}
                style={({ pressed }) => [styles.favoriteRow, { backgroundColor: c.card, borderColor: pinned ? c.primary : c.border, opacity: disabled && !pinned ? 0.45 : pressed ? 0.78 : 1 }]}
              >
                <Feather name={command.icon as React.ComponentProps<typeof Feather>["name"]} size={18} color={c.primary} />
                <View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: c.foreground }]}>{command.title.replace(/^Open /, "")}</Text><Text style={[styles.rowDescription, { color: c.mutedForeground }]}>{command.subtitle}</Text></View>
                <Feather name={pinned ? "check-square" : "square"} size={20} color={pinned ? c.primary : c.mutedForeground} />
              </Pressable>;
            })}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Reset dashboard layout" disabled={loading} onPress={onReset} style={[styles.resetButton, { borderColor: c.border, opacity: loading ? 0.5 : 1 }]}>
              <Feather name="rotate-ccw" size={16} color={c.foreground} />
              <Text style={[styles.resetText, { color: c.foreground }]}>Reset default</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.doneButton, { backgroundColor: c.primary }]}>
              <Text style={[styles.doneText, { color: c.primaryForeground }]}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  backdropCompact: { justifyContent: "flex-end", padding: 0 },
  dialog: { width: "100%", maxWidth: 660, maxHeight: "84%", borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  dialogCompact: { maxWidth: "100%", maxHeight: "92%", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 22, borderBottomWidth: 1 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 22, letterSpacing: -0.4 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20, marginTop: 5 },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  list: { padding: 18, gap: 12 },
  sectionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  currentLayout: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sectionCopy: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18 },
  presetList: { gap: 8, marginBottom: 8 },
  preset: { borderRadius: 14, padding: 13, gap: 4 },
  presetHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  presetTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  favoriteRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  dragIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  rowDescription: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17, marginTop: 3 },
  required: { fontFamily: "Inter_700Bold", fontSize: 11, marginTop: 5, textTransform: "uppercase", letterSpacing: 0.6 },
  rowActions: { alignItems: "flex-end", gap: 10 },
  moveActions: { flexDirection: "row", gap: 6 },
  smallButton: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  switch: { width: 44, height: 25, borderRadius: 13, padding: 3, justifyContent: "center" },
  switchThumb: { width: 19, height: 19, borderRadius: 10, backgroundColor: "#ffffff" },
  switchThumbOn: { alignSelf: "flex-end" },
  footer: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 18 },
  resetButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 15, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  resetText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  doneButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  doneText: { color: "#ffffff", fontFamily: "Inter_700Bold", fontSize: 14 },
});

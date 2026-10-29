import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";
import {
  ACCENT_CHOICES,
  APPEARANCE_PRESETS,
  appearancePalette,
  type ThemeMode,
  type BackdropChoice,
  type AppearanceContrast,
} from "@/lib/appearance";

export function AppearanceSettings() {
  const c = useColors();
  const {
    appearance,
    updateAppearance,
    applyPreset,
    resetAppearance,
    presetName,
    ready,
    saving,
    saveError,
    retrySave,
    loadError,
    retryLoad,
  } = useThemeMode();
  const option = (
    label: string,
    selected: boolean,
    action: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      key={accessibilityLabel}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled: !ready }}
      aria-pressed={selected}
      disabled={!ready}
      onPress={action}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected ? c.primary : c.card,
          borderColor: selected ? c.primary : c.border,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.optionText,
          { color: selected ? c.primaryForeground : c.foreground },
        ]}
      >
        {label}
      </Text>
      {selected ? (
        <Feather name="check" size={14} color={c.primaryForeground} />
      ) : null}
    </Pressable>
  );
  return (
    <View style={styles.root}>
      <View style={styles.headingRow}>
        <View style={styles.flex}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: c.foreground }]}
          >
            Make FlowLedger yours
          </Text>
          <Text style={[styles.copy, { color: c.mutedForeground }]}>
            Start with a preset, then fine-tune your look.
          </Text>
        </View>
        <View style={[styles.currentPill, { backgroundColor: c.secondary }]}>
          <Text style={[styles.pillText, { color: c.secondaryForeground }]}>
            {presetName}
          </Text>
        </View>
      </View>
      <View
        accessibilityLabel="Appearance preview"
        style={[
          styles.preview,
          { backgroundColor: c.background, borderColor: c.border },
        ]}
      >
        {appearance.backdrop !== "plain" ? (
          <View
            pointerEvents="none"
            style={[
              styles.previewGlow,
              {
                backgroundColor: c.primary,
                opacity: appearance.backdrop === "subtle" ? 0.045 : 0.11,
              },
            ]}
          />
        ) : null}
        <View style={styles.previewHeader}>
          <Text style={[styles.previewBrand, { color: c.foreground }]}>
            FLOWLEDGER
          </Text>
          <View style={[styles.previewDot, { backgroundColor: c.primary }]} />
        </View>
        <View
          style={[
            styles.previewCard,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Text style={[styles.previewLabel, { color: c.mutedForeground }]}>
            SAMPLE BALANCE
          </Text>
          <Text style={[styles.previewAmount, { color: c.foreground }]}>
            $2,450.00
          </Text>
          <View style={styles.previewBottom}>
            <View style={styles.flex}>
              <Text style={[styles.previewSmall, { color: c.mutedForeground }]}>
                Your plan, at a glance
              </Text>
              <View style={[styles.previewTrack, { backgroundColor: c.muted }]}>
                <View
                  style={[
                    styles.previewProgress,
                    { backgroundColor: c.primary },
                  ]}
                />
              </View>
            </View>
            <View
              style={[styles.previewAction, { backgroundColor: c.primary }]}
            >
              <Feather
                name="arrow-up-right"
                size={18}
                color={c.primaryForeground}
              />
            </View>
          </View>
        </View>
        <Text style={[styles.previewFoot, { color: c.mutedForeground }]}>
          Live preview · example amounts
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: c.foreground }]}
      >
        Presets
      </Text>
      <View style={styles.presets}>
        {APPEARANCE_PRESETS.map((p) => {
          const selected = presetName === p.name;
          const palette = appearancePalette(
            p.preferences.themeMode === "light" ? "light" : "dark",
            p.preferences,
            colors[p.preferences.themeMode === "light" ? "light" : "dark"],
          );
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${p.name} preset`}
              accessibilityState={{ selected, disabled: !ready }}
              aria-pressed={selected}
              disabled={!ready}
              onPress={() => applyPreset(p.id)}
              style={({ pressed }) => [
                styles.preset,
                {
                  backgroundColor: c.card,
                  borderColor: selected ? c.primary : c.border,
                  borderWidth: selected ? 2 : 1,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.presetSample,
                  {
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.sampleBar,
                    { backgroundColor: palette.primary },
                  ]}
                />
                <View
                  style={[
                    styles.sampleBlock,
                    { backgroundColor: palette.card },
                  ]}
                >
                  <View
                    style={[
                      styles.sampleLine,
                      { backgroundColor: palette.mutedForeground },
                    ]}
                  />
                  <View
                    style={[
                      styles.sampleLineShort,
                      { backgroundColor: palette.primary },
                    ]}
                  />
                </View>
                {selected ? (
                  <View style={[styles.check, { backgroundColor: c.primary }]}>
                    <Feather
                      name="check"
                      size={13}
                      color={c.primaryForeground}
                    />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.presetName, { color: c.foreground }]}>
                {p.name}
              </Text>
              <Text
                style={[styles.presetDescription, { color: c.mutedForeground }]}
              >
                {p.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: c.foreground }]}
      >
        Customize this look
      </Text>
      <Text style={[styles.label, { color: c.foreground }]}>Display mode</Text>
      <View style={styles.options}>
        {(
          [
            { id: "auto", name: "System" },
            { id: "dark", name: "Dark" },
            { id: "light", name: "Light" },
          ] as const
        ).map((x) =>
          option(
            x.name,
            appearance.themeMode === x.id,
            () => updateAppearance({ themeMode: x.id as ThemeMode }),
            `Use ${x.name} mode`,
          ),
        )}
      </View>
      <Text style={[styles.label, { color: c.foreground }]}>Accent color</Text>
      <View style={styles.accents}>
        {ACCENT_CHOICES.map((a) => {
          const selected = appearance.accent === a.id;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${a.name} accent`}
              accessibilityState={{ selected, disabled: !ready }}
              aria-pressed={selected}
              disabled={!ready}
              onPress={() => updateAppearance({ accent: a.id })}
              style={({ pressed }) => [
                styles.accentOption,
                {
                  backgroundColor: c.card,
                  borderColor: selected ? c.primary : c.border,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: c.isDark ? a.darkColor : a.color },
                ]}
              >
                {selected ? (
                  <Feather
                    name="check"
                    size={14}
                    color={
                      appearancePalette(
                        c.mode,
                        { ...appearance, accent: a.id },
                        colors[c.mode],
                      ).primaryForeground
                    }
                  />
                ) : null}
              </View>
              <Text style={[styles.accentName, { color: c.foreground }]}>
                {a.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.label, { color: c.foreground }]}>Background</Text>
      <View style={styles.options}>
        {(["ambient", "subtle", "plain"] as BackdropChoice[]).map((id) => {
          const name = id[0].toUpperCase() + id.slice(1);
          return option(
            name,
            appearance.backdrop === id,
            () => updateAppearance({ backdrop: id }),
            `Use ${name} background`,
          );
        })}
      </View>
      <Text style={[styles.label, { color: c.foreground }]}>Contrast</Text>
      <View style={styles.options}>
        {(["standard", "high"] as AppearanceContrast[]).map((id) => {
          const name = id[0].toUpperCase() + id.slice(1);
          return option(
            name,
            appearance.contrast === id,
            () => updateAppearance({ contrast: id }),
            `Use ${name} contrast`,
          );
        })}
      </View>
      <View style={[styles.saveStatus, { borderColor: c.border }]}>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.copy,
            styles.flex,
            {
              color: saveError || loadError ? c.destructive : c.mutedForeground,
            },
          ]}
        >
          {loadError
            ? "Couldn’t load your saved look. Retry to restore it, or choose a new look."
            : saveError
              ? "Couldn’t save this look on this device. Try again."
              : saving
                ? "Saving your look…"
                : "Saved on this device. Changes apply throughout the app."}
        </Text>
        {saveError || loadError ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              loadError ? "Retry loading appearance" : "Retry saving appearance"
            }
            onPress={loadError ? retryLoad : retrySave}
            style={[styles.retry, { borderColor: c.border }]}
          >
            <Text style={[styles.optionText, { color: c.foreground }]}>
              Retry
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset appearance"
        disabled={!ready}
        onPress={resetAppearance}
        style={({ pressed }) => [
          styles.reset,
          {
            borderColor: c.border,
            backgroundColor: c.card,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        <Feather name="rotate-ccw" size={16} color={c.foreground} />
        <Text style={[styles.optionText, { color: c.foreground }]}>
          Reset to original look
        </Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 26 },
  copy: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  currentPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  preview: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    overflow: "hidden",
  },
  previewGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -70,
  },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  previewBrand: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 2 },
  previewDot: { width: 12, height: 12, borderRadius: 4 },
  previewCard: { borderWidth: 1, borderRadius: 16, padding: 18 },
  previewLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    letterSpacing: 1,
  },
  previewAmount: {
    fontFamily: "Inter_700Bold",
    fontSize: 30,
    lineHeight: 39,
    marginTop: 4,
  },
  previewBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 14,
  },
  previewSmall: { fontFamily: "Inter_400Regular", fontSize: 11 },
  previewTrack: {
    height: 5,
    borderRadius: 4,
    marginTop: 9,
    overflow: "hidden",
  },
  previewProgress: { width: "68%", height: 5, borderRadius: 4 },
  previewAction: {
    height: 36,
    width: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  previewFoot: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 10 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 10 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  preset: {
    flexBasis: "45%",
    flexGrow: 1,
    minWidth: 130,
    padding: 10,
    borderRadius: 16,
  },
  presetSample: {
    height: 69,
    borderRadius: 9,
    borderWidth: 1,
    overflow: "hidden",
    padding: 9,
  },
  sampleBar: { width: "48%", height: 5, borderRadius: 4, marginBottom: 8 },
  sampleBlock: { padding: 7, borderRadius: 6 },
  sampleLine: { width: "70%", height: 3, opacity: 0.5, borderRadius: 2 },
  sampleLineShort: { width: "45%", height: 5, marginTop: 6, borderRadius: 3 },
  check: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  presetName: { fontFamily: "Inter_700Bold", fontSize: 13, marginTop: 8 },
  presetDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 13, marginTop: 7 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 7,
  },
  optionText: { fontFamily: "Inter_600SemiBold", fontSize: 13, flexShrink: 1 },
  accents: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accentOption: {
    flexBasis: "29%",
    flexGrow: 1,
    minWidth: 84,
    minHeight: 65,
    padding: 9,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    gap: 6,
  },
  swatch: {
    width: 25,
    height: 25,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  accentName: { fontFamily: "Inter_500Medium", fontSize: 11 },
  saveStatus: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingTop: 14,
    marginTop: 5,
    borderTopWidth: 1,
  },
  retry: {
    minHeight: 44,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
  },
  reset: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
});

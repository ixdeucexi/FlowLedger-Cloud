import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { useCalendarAppearance } from "@/hooks/useCalendarAppearance";
import {
  CALENDAR_CATEGORIES,
  CALENDAR_COLOR_CHOICES,
  type CalendarCategory,
  type CalendarColorChoice,
} from "@/lib/calendarColors";

export function CalendarAppearanceSettings() {
  const c = useColors();
  const tones = useCalendarAppearance();
  const { appearance, updateAppearance, ready } = useThemeMode();
  const [expanded, setExpanded] = useState<CalendarCategory | null>(null);
  const choose = (kind: CalendarCategory, choice?: CalendarColorChoice) => {
    updateAppearance((current) => {
      const next = { ...current.calendarColors };
      if (choice) next[kind] = choice;
      else delete next[kind];
      return { calendarColors: Object.keys(next).length ? next : undefined };
    });
  };
  return (
    <View style={styles.root}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: c.foreground }]}
      >
        Forecast calendar colors
      </Text>
      <Text style={[styles.copy, { color: c.mutedForeground }]}>
        Custom calendar colors stay when you change presets. Choose Follow theme
        to link a category again. Labels and risk alerts stay the same.
      </Text>
      <View
        accessibilityLabel="Calendar color preview"
        style={[
          styles.preview,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        {CALENDAR_CATEGORIES.map(({ id, label }) => (
          <View
            key={id}
            accessibilityLabel={`${label} calendar color`}
            style={[
              styles.sample,
              { backgroundColor: tones[id].bg, borderColor: tones[id].border },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: tones[id].color }]} />
            <Text style={[styles.sampleText, { color: tones[id].text }]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      {CALENDAR_CATEGORIES.map(({ id, label }) => {
        const custom = CALENDAR_COLOR_CHOICES.find(
          (choice) => choice.id === appearance.calendarColors?.[id],
        );
        return (
          <View
            key={id}
            style={[
              styles.category,
              { borderColor: c.border, backgroundColor: c.card },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Customize ${label} color`}
              accessibilityState={{
                expanded: expanded === id,
                disabled: !ready,
              }}
              disabled={!ready}
              onPress={() => setExpanded(expanded === id ? null : id)}
              style={styles.row}
            >
              <View
                style={[styles.dot, { backgroundColor: tones[id].color }]}
              />
              <Text style={[styles.name, { color: c.foreground }]}>
                {label}
              </Text>
              <Text style={[styles.value, { color: c.mutedForeground }]}>
                {custom?.name ?? "Follow theme"}
              </Text>
              <Feather
                name={expanded === id ? "chevron-up" : "chevron-down"}
                size={16}
                color={c.mutedForeground}
              />
            </Pressable>
            {expanded === id ? (
              <View style={styles.choices}>
                {[
                  { id: undefined, name: "Theme" },
                  ...CALENDAR_COLOR_CHOICES,
                ].map((choice) => {
                  const selected =
                    appearance.calendarColors?.[id] === choice.id;
                  const color = choice.id
                    ? CALENDAR_COLOR_CHOICES.find((x) => x.id === choice.id)![
                        c.mode
                      ]
                    : c.primary;
                  return (
                    <Pressable
                      key={choice.id ?? "theme"}
                      accessibilityRole="button"
                      accessibilityLabel={
                        choice.id
                          ? `Use ${choice.name} for ${label}`
                          : `Use theme color for ${label}`
                      }
                      accessibilityState={{ selected, disabled: !ready }}
                      aria-pressed={selected}
                      disabled={!ready}
                      onPress={() => choose(id, choice.id)}
                      style={({ pressed }) => [
                        styles.choice,
                        {
                          borderColor: selected ? c.primary : c.border,
                          backgroundColor: selected ? c.secondary : c.card,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.dot, { backgroundColor: color }]} />
                      <Text
                        style={[styles.sampleText, { color: c.foreground }]}
                      >
                        {choice.name}
                      </Text>
                      {selected ? (
                        <Feather name="check" size={13} color={c.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset calendar colors"
        disabled={!ready}
        onPress={() => updateAppearance({ calendarColors: undefined })}
        style={({ pressed }) => [
          styles.reset,
          {
            borderColor: c.border,
            backgroundColor: c.card,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Feather name="rotate-ccw" size={16} color={c.foreground} />
        <Text style={[styles.sampleText, { color: c.foreground }]}>
          Use theme colors for calendar
        </Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 9, marginTop: 10 },
  heading: { fontFamily: "Inter_700Bold", fontSize: 17 },
  copy: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  preview: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sample: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
  },
  sampleText: { fontFamily: "Inter_600SemiBold", fontSize: 12, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  category: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
  value: { fontFamily: "Inter_400Regular", fontSize: 12 },
  choices: {
    padding: 10,
    paddingTop: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  choice: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexGrow: 1,
  },
  reset: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
});

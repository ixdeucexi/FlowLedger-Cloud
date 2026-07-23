import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  SETTINGS_GROUPS,
  settingsSectionById,
  type SettingsDestinationId,
  type SettingsStatus,
} from "@/lib/settingsHub";
import { isCompactSettingsLayout } from "@/lib/settingsLayout";

interface MoreHubProps {
  householdName: string;
  householdRole: string;
  identity: string;
  membershipLabel: string;
  statuses: Partial<Record<SettingsDestinationId, SettingsStatus>>;
  onOpenSection: (sectionId: SettingsDestinationId) => void;
}

export function MoreHub({
  householdName,
  householdRole,
  identity,
  membershipLabel,
  statuses,
  onOpenSection,
}: MoreHubProps) {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactSettingsLayout(viewportWidth);

  return (
    <>
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

      <View style={styles.householdHeading}>
        <View style={styles.householdCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>CURRENT HOUSEHOLD</Text>
          <View style={styles.householdNameRow}>
            <Text style={[styles.householdName, { color: colors.foreground }]} numberOfLines={1}>{householdName}</Text>
            <View style={[styles.membershipPill, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}>
              <Text style={[styles.membershipText, { color: colors.primary }]} numberOfLines={1}>{membershipLabel}</Text>
            </View>
          </View>
          <Text style={[styles.identity, { color: colors.mutedForeground }]} numberOfLines={1}>{identity} · {householdRole}</Text>
        </View>
      </View>

      {SETTINGS_GROUPS.map(group => (
        <View key={group.id} style={styles.groupBlock}>
          <Text style={[styles.groupTitle, { color: colors.foreground }]}>{group.label}</Text>
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {group.sectionIds.map((sectionId, index) => {
              const section = settingsSectionById(sectionId);
              const status = statuses[sectionId];
              const isLast = index === group.sectionIds.length - 1;
              return (
                <Pressable
                  key={section.id}
                  accessibilityRole="button"
                  accessibilityLabel={status ? `${section.label}, ${status.label}` : section.label}
                  accessibilityHint={section.description}
                  onPress={() => onOpenSection(section.id)}
                  style={({ pressed }) => [
                    styles.row,
                    compactLayout && styles.rowCompact,
                    {
                      borderBottomColor: colors.border,
                      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                      backgroundColor: pressed ? colors.primary + "0A" : "transparent",
                    },
                  ]}
                >
                  <View style={[styles.rowIcon, compactLayout && styles.rowIconCompact, { backgroundColor: colors.primary + "11" }]}>
                    <Feather name={section.icon as ComponentProps<typeof Feather>["name"]} size={19} color={colors.primary} />
                  </View>
                  <View style={[styles.rowMain, compactLayout && styles.rowMainCompact]}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{section.label}</Text>
                    {status ? (
                      <View style={[
                        styles.statusPill,
                        {
                          backgroundColor: status.tone === "attention" ? colors.warning + "18" : colors.muted,
                          borderColor: status.tone === "attention" ? colors.warning + "38" : colors.border,
                        },
                      ]}>
                        <Text style={[styles.statusText, { color: status.tone === "attention" ? colors.warning : colors.mutedForeground }]} numberOfLines={1}>{status.label}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, marginBottom: 24 },
  householdHeading: { paddingHorizontal: 16, marginBottom: 26 },
  householdCopy: { minWidth: 0 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginBottom: 5 },
  householdNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  householdName: { flexShrink: 1, fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.45 },
  identity: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 4 },
  membershipPill: { maxWidth: 104, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  membershipText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  groupBlock: { marginBottom: 24 },
  groupTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.35, marginBottom: 9, paddingHorizontal: 12 },
  groupCard: { borderWidth: 1, borderRadius: 22, overflow: "hidden" },
  row: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  rowCompact: { paddingHorizontal: 10, gap: 8 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowIconCompact: { width: 34, height: 34 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  rowMainCompact: { alignItems: "flex-start", flexDirection: "column", gap: 4 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: "Inter_700Bold" },
  statusPill: { maxWidth: 108, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 9, fontFamily: "Inter_800ExtraBold" },
});

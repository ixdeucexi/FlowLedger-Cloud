import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  settingsSectionById,
  type SettingsDestinationId,
  type SettingsStatus,
  visibleSettingsGroups,
} from "@/lib/settingsHub";
import { isCompactSettingsLayout } from "@/lib/settingsLayout";

interface MoreHubProps {
  householdName: string;
  householdRole: string;
  identity: string;
  membershipLabel: string;
  statuses: Partial<Record<SettingsDestinationId, SettingsStatus>>;
  isAdmin: boolean;
  onOpenSection: (sectionId: SettingsDestinationId) => void;
  onOpenSearch: () => void;
  onOpenCommands: () => void;
  onOpenNotifications: () => void;
  unreadNotificationCount: number;
}

export function MoreHub({
  householdName,
  householdRole,
  identity,
  membershipLabel,
  statuses,
  isAdmin,
  onOpenSection,
  onOpenSearch,
  onOpenCommands,
  onOpenNotifications,
  unreadNotificationCount,
}: MoreHubProps) {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactSettingsLayout(viewportWidth);
  const stackQuickActions = viewportWidth < 430;

  return (
    <>
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

      <View style={[styles.householdHeading, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.householdCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>PLAN & ACCOUNT</Text>
          <View style={styles.householdNameRow}>
            <Text style={[styles.householdName, { color: colors.foreground }]}>{householdName}</Text>
            <View style={[styles.membershipPill, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}>
              <Text style={[styles.membershipText, { color: colors.primary }]} numberOfLines={1}>{membershipLabel}</Text>
            </View>
          </View>
          <Text style={[styles.identity, { color: colors.mutedForeground }]}>{identity} · {householdRole}</Text>
        </View>
      </View>

      <View style={styles.groupBlock}>
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>Quick access</Text>
        <View style={[styles.quickGrid, stackQuickActions && styles.quickGridCompact]}>
          {[
            { label: "Search", description: "Find anything", icon: "search" as const, onPress: onOpenSearch },
            { label: "Quick Actions", description: "Add or navigate", icon: "zap" as const, onPress: onOpenCommands },
            { label: "Alerts", description: unreadNotificationCount ? `${unreadNotificationCount} unread` : "All caught up", icon: "bell" as const, onPress: onOpenNotifications },
          ].map(action => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={`${action.label}. ${action.description}`}
              onPress={action.onPress}
              style={({ pressed }) => [styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}
            >
              <View style={[styles.quickIcon, { backgroundColor: colors.primary + "16" }]}>
                <Feather name={action.icon} size={19} color={colors.primary} />
              </View>
              <Text style={[styles.quickLabel, { color: colors.foreground }]}>{action.label}</Text>
              <Text style={[styles.quickDescription, { color: colors.mutedForeground }]}>{action.description}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {visibleSettingsGroups(isAdmin).map(group => (
        <View key={group.id} style={styles.groupBlock}>
          <Text style={[styles.groupTitle, { color: colors.foreground }]}>{group.label}</Text>
          <Text style={[styles.groupDescription, { color: colors.mutedForeground }]}>{group.description}</Text>
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
                  <View style={styles.rowMain}>
                    <View style={styles.rowCopy}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>{section.label}</Text>
                      <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{section.description}</Text>
                    </View>
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
  title: { fontSize: 31, fontFamily: "Inter_800ExtraBold", letterSpacing: -1, marginBottom: 16 },
  householdHeading: { borderWidth: 1, borderRadius: 24, padding: 17, marginBottom: 24 },
  householdCopy: { minWidth: 0 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginBottom: 5 },
  householdNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  householdName: { flexShrink: 1, fontSize: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.45 },
  identity: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 4 },
  membershipPill: { maxWidth: 104, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  membershipText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  groupBlock: { marginBottom: 26 },
  quickGrid: { flexDirection: "row", gap: 10 },
  quickGridCompact: { flexDirection: "column" },
  quickCard: { flex: 1, minHeight: 96, borderWidth: 1, borderRadius: 20, padding: 13 },
  quickIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  quickLabel: { fontFamily: "Inter_700Bold", fontSize: 14 },
  quickDescription: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 3 },
  groupTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.25, marginBottom: 3, paddingHorizontal: 4 },
  groupDescription: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginBottom: 10, paddingHorizontal: 4 },
  groupCard: { borderWidth: 1, borderRadius: 24, overflow: "hidden" },
  row: { minHeight: 78, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  rowCompact: { paddingHorizontal: 10, gap: 8 },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  rowIconCompact: { width: 34, height: 34 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  rowDescription: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2 },
  statusPill: { maxWidth: 108, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 9, fontFamily: "Inter_800ExtraBold" },
});

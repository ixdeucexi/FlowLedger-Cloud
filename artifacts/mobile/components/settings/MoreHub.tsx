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
        <View style={styles.quickGrid}>
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
              style={({ pressed }) => [
                styles.quickCard,
                compactLayout && styles.quickCardCompact,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <View style={[styles.quickIcon, compactLayout && styles.quickIconCompact, { backgroundColor: colors.primary + "16" }]}>
                <Feather name={action.icon} size={19} color={colors.primary} />
              </View>
              <View style={styles.quickCopy}>
                <Text style={[styles.quickLabel, compactLayout && styles.quickLabelCompact, { color: colors.foreground }]} numberOfLines={2}>{action.label}</Text>
                {!compactLayout ? <Text style={[styles.quickDescription, { color: colors.mutedForeground }]} numberOfLines={1}>{action.description}</Text> : null}
              </View>
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
                  nativeID={section.id === "setup" ? "guided-tour-more" : undefined}
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
                    <View style={styles.rowCopy}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>{section.label}</Text>
                      <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{section.description}</Text>
                    </View>
                    {status ? (
                      <View style={[
                        styles.statusPill,
                        compactLayout && styles.statusPillCompact,
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
  title: { fontSize: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.9, marginBottom: 12 },
  householdHeading: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 18 },
  householdCopy: { minWidth: 0 },
  eyebrow: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, marginBottom: 4 },
  householdNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  householdName: { flexShrink: 1, fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.35 },
  identity: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 15, marginTop: 3 },
  membershipPill: { maxWidth: 104, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  membershipText: { fontSize: 8, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.35 },
  groupBlock: { marginBottom: 18 },
  quickGrid: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  quickCard: { flexGrow: 1, flexShrink: 1, flexBasis: 0, maxWidth: 132, aspectRatio: 1, borderWidth: 1, borderRadius: 16, padding: 9, alignItems: "center", justifyContent: "center", gap: 6 },
  quickCardCompact: { padding: 6, gap: 4 },
  quickIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quickIconCompact: { width: 24, height: 24, borderRadius: 8 },
  quickCopy: { width: "100%", minWidth: 0, alignItems: "center" },
  quickLabel: { fontFamily: "Inter_700Bold", fontSize: 12, textAlign: "center" },
  quickLabelCompact: { fontSize: 10 },
  quickDescription: { fontFamily: "Inter_500Medium", fontSize: 9, marginTop: 2, textAlign: "center" },
  groupTitle: { fontSize: 16, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2, marginBottom: 2, paddingHorizontal: 3 },
  groupDescription: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", marginBottom: 8, paddingHorizontal: 3 },
  groupCard: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  row: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCompact: { paddingHorizontal: 9, gap: 7 },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowIconCompact: { width: 32, height: 32 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  rowMainCompact: { alignItems: "stretch", flexDirection: "column", gap: 4 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowDescription: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 2 },
  statusPill: { maxWidth: 108, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillCompact: { maxWidth: "100%", alignSelf: "flex-start" },
  statusText: { fontSize: 9, fontFamily: "Inter_800ExtraBold" },
});

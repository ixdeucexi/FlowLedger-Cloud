import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  SETTINGS_GROUPS,
  settingsGroupById,
  settingsSectionById,
  type SettingsDestinationId,
  type SettingsGroup,
  type SettingsStatus,
} from "@/lib/settingsHub";

const GROUP_PRESENTATION: Record<SettingsGroup["id"], {
  icon: ComponentProps<typeof Feather>["name"];
  description: string;
}> = {
  money: { icon: "dollar-sign", description: "Accounts, bank sync, plans, goals, and child money." },
  insights: { icon: "bar-chart-2", description: "Reviews, subscriptions, and reports." },
  preferences: { icon: "sliders", description: "Flo setup, appearance, notifications, and data." },
  account: { icon: "user", description: "Membership, security, support, and legal." },
};

interface MoreHubProps {
  householdName: string;
  householdRole: string;
  identity: string;
  membershipLabel: string;
  statuses: Partial<Record<SettingsDestinationId, SettingsStatus>>;
  activeGroupId: SettingsGroup["id"] | null;
  onOpenGroup: (groupId: SettingsGroup["id"]) => void;
  onBackToGroups: () => void;
  onOpenSection: (sectionId: SettingsDestinationId) => void;
}

export function MoreHub({
  householdName,
  householdRole,
  identity,
  membershipLabel,
  statuses,
  activeGroupId,
  onOpenGroup,
  onBackToGroups,
  onOpenSection,
}: MoreHubProps) {
  const colors = useColors();
  const activeGroup = activeGroupId ? settingsGroupById(activeGroupId) : null;

  const renderSectionRows = (group: SettingsGroup) => group.sectionIds.map((sectionId, index) => {
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
          {
            borderBottomColor: colors.border,
            borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.primary + "12" }]}>
          <Feather name={section.icon as ComponentProps<typeof Feather>["name"]} size={18} color={colors.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>{section.label}</Text>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]} numberOfLines={1}>{section.description}</Text>
        </View>
        {status ? (
          <View style={[
            styles.statusPill,
            {
              backgroundColor: status.tone === "attention" ? colors.warning + "18" : colors.muted,
              borderColor: status.tone === "attention" ? colors.warning + "38" : colors.border,
            },
          ]}>
            <Text
              style={[styles.statusText, { color: status.tone === "attention" ? colors.warning : colors.mutedForeground }]}
              numberOfLines={1}
            >
              {status.label}
            </Text>
          </View>
        ) : null}
        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
      </Pressable>
    );
  });

  if (activeGroup) {
    const presentation = GROUP_PRESENTATION[activeGroup.id];
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to More"
          onPress={onBackToGroups}
          hitSlop={8}
          style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Feather name="chevron-left" size={22} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>More</Text>
        </Pressable>
        <View style={styles.groupScreenHeading}>
          <View style={[styles.groupScreenIcon, { backgroundColor: colors.primary + "16" }]}>
            <Feather name={presentation.icon} size={22} color={colors.primary} />
          </View>
          <View style={styles.groupCopy}>
            <Text style={[styles.groupScreenTitle, { color: colors.foreground }]}>{activeGroup.label}</Text>
            <Text style={[styles.groupScreenDescription, { color: colors.mutedForeground }]}>{presentation.description}</Text>
          </View>
        </View>
        <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renderSectionRows(activeGroup)}
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={[styles.title, { color: colors.foreground }]}>More</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Manage your money plan, connections, and app.</Text>

      <View style={[styles.accountSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.accountIcon, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="users" size={20} color={colors.primary} />
        </View>
        <View style={styles.accountCopy}>
          <Text style={[styles.householdName, { color: colors.foreground }]} numberOfLines={1}>{householdName}</Text>
          <Text style={[styles.identity, { color: colors.mutedForeground }]} numberOfLines={1}>
            {identity} · {householdRole}
          </Text>
        </View>
        <View style={[styles.membershipPill, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "32" }]}>
          <Text style={[styles.membershipText, { color: colors.primary }]} numberOfLines={1}>{membershipLabel}</Text>
        </View>
      </View>

      {SETTINGS_GROUPS.map(group => {
        const presentation = GROUP_PRESENTATION[group.id];
        return (
          <View key={group.id} style={styles.groupBlock}>
            <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={group.label}
                accessibilityHint={`Opens ${group.label} settings`}
                onPress={() => onOpenGroup(group.id)}
                style={({ pressed }) => [styles.groupHeader, { opacity: pressed ? 0.68 : 1 }]}
              >
                <View style={[styles.groupIcon, { backgroundColor: colors.primary + "16" }]}>
                  <Feather name={presentation.icon} size={19} color={colors.primary} />
                </View>
                <View style={styles.groupCopy}>
                  <Text style={[styles.groupTitle, { color: colors.foreground }]}>{group.label}</Text>
                  <Text style={[styles.groupDescription, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {presentation.description}
                  </Text>
                </View>
                <Text style={[styles.groupCount, { color: colors.mutedForeground }]}>{group.sectionIds.length}</Text>
                <Feather name="chevron-right" size={20} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 34, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.1 },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, marginTop: 3, marginBottom: 16 },
  accountSummary: { minHeight: 72, borderWidth: 1, borderRadius: 20, padding: 12, flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 22, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 3 },
  accountIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  accountCopy: { flex: 1, minWidth: 0 },
  householdName: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  identity: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 2 },
  membershipPill: { maxWidth: 92, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  membershipText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  groupBlock: { marginBottom: 12 },
  groupCard: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  groupHeader: { minHeight: 72, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 11 },
  groupIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  groupCopy: { flex: 1, minWidth: 0 },
  groupTitle: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  groupDescription: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 2 },
  groupCount: { minWidth: 18, fontSize: 11, fontFamily: "Inter_700Bold", textAlign: "center" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  groupScreenHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  groupScreenIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  groupScreenTitle: { fontSize: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  groupScreenDescription: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18, marginTop: 2 },
  row: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  rowDescription: { fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 16, marginTop: 2 },
  statusPill: { maxWidth: 104, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});

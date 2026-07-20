import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { householdRoleLabel, type HouseholdInviteRole, type HouseholdRole } from "@/lib/householdPermissions";

const ROLE_DETAILS: Record<HouseholdInviteRole, string> = {
  manager: "Can manage people and edit the household plan.",
  editor: "Can add and change the household plan.",
  viewer: "Can view the household without making changes.",
};

interface Props {
  visible: boolean;
  memberName: string;
  currentRole: HouseholdRole;
  roleOptions: HouseholdInviteRole[];
  canRemove: boolean;
  busy: boolean;
  onClose: () => void;
  onChangeRole: (role: HouseholdInviteRole) => void;
  onRemove: () => void;
}

export function HouseholdMemberActionsModal({
  visible,
  memberName,
  currentRole,
  roleOptions,
  canRemove,
  busy,
  onClose,
  onChangeRole,
  onRemove,
}: Props) {
  const c = useColors();
  useBackDismiss(visible, onClose);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.titleCopy}>
              <Text style={[styles.eyebrow, { color: c.primary }]}>HOUSEHOLD MEMBER</Text>
              <Text style={[styles.title, { color: c.foreground }]} numberOfLines={2}>Manage {memberName}</Text>
              <Text style={[styles.currentRole, { color: c.mutedForeground }]}>Current access: {householdRoleLabel(currentRole)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close member options" onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>ACCESS LEVEL</Text>
          <View style={styles.optionList}>
            {roleOptions.map(role => {
              const selected = role === currentRole;
              return (
                <Pressable
                  key={role}
                  accessibilityRole="button"
                  accessibilityLabel={`Set ${memberName} access to ${householdRoleLabel(role)}`}
                  disabled={busy || selected}
                  onPress={() => onChangeRole(role)}
                  style={({ pressed }) => [
                    styles.roleOption,
                    {
                      backgroundColor: selected ? c.primary + "18" : c.muted,
                      borderColor: selected ? c.primary : c.border,
                      opacity: busy ? 0.55 : pressed ? 0.76 : 1,
                    },
                  ]}
                >
                  <View style={[styles.roleIcon, { backgroundColor: selected ? c.primary + "20" : c.card }]}>
                    <Feather name={role === "manager" ? "shield" : role === "editor" ? "edit-3" : "eye"} size={16} color={selected ? c.primary : c.mutedForeground} />
                  </View>
                  <View style={styles.roleCopy}>
                    <Text style={[styles.roleTitle, { color: c.foreground }]}>{householdRoleLabel(role)}</Text>
                    <Text style={[styles.roleDetail, { color: c.mutedForeground }]}>{ROLE_DETAILS[role]}</Text>
                  </View>
                  <Feather name={selected ? "check-circle" : "chevron-right"} size={18} color={selected ? c.primary : c.mutedForeground} />
                </Pressable>
              );
            })}
          </View>

          {canRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${memberName} from household`}
              disabled={busy}
              onPress={onRemove}
              style={({ pressed }) => [styles.removeButton, { borderColor: c.destructive + "66", opacity: busy ? 0.55 : pressed ? 0.74 : 1 }]}
            >
              <Feather name="user-minus" size={17} color={c.destructive} />
              <View style={styles.roleCopy}>
                <Text style={[styles.removeTitle, { color: c.destructive }]}>Remove from household</Text>
                <Text style={[styles.roleDetail, { color: c.mutedForeground }]}>They will lose access to this shared plan.</Text>
              </View>
            </Pressable>
          ) : null}

          <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={[styles.doneButton, { backgroundColor: c.primary, opacity: busy ? 0.55 : 1 }]}>
            <Text style={[styles.doneText, { color: c.primaryForeground }]}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 480, borderWidth: 1, borderRadius: 24, padding: 18 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  title: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", marginTop: 4 },
  currentRole: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, marginTop: 18, marginBottom: 8 },
  optionList: { gap: 8 },
  roleOption: { minHeight: 66, borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  roleIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  roleCopy: { flex: 1, minWidth: 0 },
  roleTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  roleDetail: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },
  removeButton: { minHeight: 62, borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  removeTitle: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  doneButton: { minHeight: 50, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 14 },
  doneText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
});

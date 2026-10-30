import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { DASHBOARD_FAVORITE_ACTIONS, type DashboardLayoutPreference } from "@/lib/dashboardCustomization";

export function DashboardFavoriteActions({ layout, onNavigate, onCustomize, canEdit = true }: {
  layout: DashboardLayoutPreference;
  onNavigate: (route: string, params?: Record<string, string>) => void;
  onCustomize: () => void;
  canEdit?: boolean;
}) {
  const c = useColors();
  const commands = layout.favoriteActions.flatMap(id => {
    const command = DASHBOARD_FAVORITE_ACTIONS.find(item => item.id === id);
    return command ? [command] : [];
  });
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Favorite actions</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit favorite dashboard actions" onPress={onCustomize} style={styles.edit}>
          <Feather name="edit-2" size={15} color={c.primary} />
          <Text style={[styles.editText, { color: c.primary }]}>Edit</Text>
        </Pressable>
      </View>
      {commands.length ? <View style={styles.grid}>
        {commands.map(command => {
          const disabled = !canEdit && command.id.startsWith("add-");
          return (
          <Pressable
            key={command.id}
            accessibilityRole="button"
            accessibilityLabel={`Favorite action: ${command.title}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onNavigate(command.route, command.params)}
            style={({ pressed }) => [styles.action, { borderColor: c.border, backgroundColor: c.primary + "0e", opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }]}
          >
            <Feather name={command.icon as React.ComponentProps<typeof Feather>["name"]} size={19} color={c.primary} />
            <Text style={[styles.actionText, { color: c.foreground }]}>{command.title.replace(/^Open /, "")}</Text>
          </Pressable>
          );
        })}
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Pin favorite dashboard actions" onPress={onCustomize} style={styles.empty}>
        <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Pin up to four actions you use most.</Text>
        <Feather name="plus" size={18} color={c.primary} />
      </Pressable>}
      {!canEdit && commands.some(command => command.id.startsWith("add-")) ? <Text style={[styles.emptyText, { color: c.mutedForeground }]}>Adding to this household plan needs edit access.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 17, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 17 },
  edit: { minHeight: 36, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  editText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  action: { flexBasis: "47%", flexGrow: 1, minWidth: 0, minHeight: 58, padding: 12, gap: 10, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center" },
  actionText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  empty: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  emptyText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13 },
});

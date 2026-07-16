import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { SettingsSectionMeta } from "@/lib/settingsHub";

interface SettingsSectionHeaderProps {
  section: SettingsSectionMeta;
  onBack: () => void;
}

export function SettingsSectionHeader({ section, onBack }: SettingsSectionHeaderProps) {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to More"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.65 : 1 }]}
      >
        <Feather name="chevron-left" size={22} color={colors.primary} />
        <Text style={[styles.backText, { color: colors.primary }]}>More</Text>
      </Pressable>
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "16" }]}>
          <Feather name={section.icon as ComponentProps<typeof Feather>["name"]} size={21} color={colors.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>{section.label}</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{section.description}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 20 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  description: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18, marginTop: 2 },
});

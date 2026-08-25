import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { SettingsSectionMeta } from "@/lib/settingsHub";
import { isCompactSettingsLayout } from "@/lib/settingsLayout";

interface SettingsSectionHeaderProps {
  section: SettingsSectionMeta;
  onBack: () => void;
  backLabel?: string;
}

export function SettingsSectionHeader({ section, onBack, backLabel = "More" }: SettingsSectionHeaderProps) {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = isCompactSettingsLayout(viewportWidth);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backLabel}`}
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => [styles.backRow, { opacity: pressed ? 0.65 : 1 }]}
      >
        <Feather name="chevron-left" size={22} color={colors.primary} />
        <Text style={[styles.backText, { color: colors.primary }]}>{backLabel}</Text>
      </Pressable>
      <View style={[styles.headingRow, compactLayout && styles.headingRowCompact]}>
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
  container: { marginBottom: 24 },
  backRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10, alignSelf: "flex-start", paddingRight: 8 },
  backText: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  headingRowCompact: { alignItems: "flex-start", flexDirection: "column", gap: 8 },
  icon: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 29, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  description: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, marginTop: 3 },
});

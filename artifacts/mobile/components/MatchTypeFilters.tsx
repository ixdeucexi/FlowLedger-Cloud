import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { matchTargetKindLabels, type MatchTargetKind } from "@/lib/matchTargetFilters";

type Props = {
  selected: MatchTargetKind | null;
  onChange: (kind: MatchTargetKind) => void;
  disabled?: boolean;
  includeCalendarPlans?: boolean;
};

export function MatchTypeFilters({ selected, onChange, disabled = false, includeCalendarPlans = false }: Props) {
  const c = useColors();
  const kinds: MatchTargetKind[] = ["bill", "debt", "manual", "bucket"];
  if (includeCalendarPlans) kinds.push("decision");
  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: c.foreground }]}>What did this payment cover?</Text>
      <View style={styles.filters}>
        {kinds.map(kind => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={`Filter matches by ${matchTargetKindLabels[kind].toLowerCase()}`}
            accessibilityState={{ selected: selected === kind, disabled }}
            aria-pressed={selected === kind}
            disabled={disabled}
            onPress={() => onChange(kind)}
            style={({ pressed }) => [styles.button, {
              borderColor: selected === kind ? c.primary : c.border,
              backgroundColor: selected === kind ? c.primary + "18" : c.card,
              opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
            }]}
          >
            <Text style={[styles.label, { color: c.foreground }]}>{matchTargetKindLabels[kind]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16, marginBottom: 12 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderWidth: 1, borderRadius: 10, minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10, maxWidth: "100%" },
  label: { fontFamily: "Inter_600SemiBold", flexShrink: 1 },
});

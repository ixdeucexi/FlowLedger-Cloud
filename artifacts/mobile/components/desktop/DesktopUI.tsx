import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";

export const desktopPalette = {
  canvas: "var(--fl-desktop-canvas, #ffffff)",
  surface: "var(--fl-desktop-surface, #ffffff)",
  surfaceMuted: "var(--fl-desktop-surface-muted, #f9fafb)",
  border: "var(--fl-desktop-border, #e4e7ec)",
  borderSoft: "var(--fl-desktop-border-soft, #eef0f3)",
  text: "var(--fl-desktop-text, #101828)",
  textSecondary: "var(--fl-desktop-text-secondary, #475467)",
  muted: "var(--fl-desktop-muted, #667085)",
  faint: "var(--fl-desktop-faint, #98a2b3)",
  purple: "var(--fl-desktop-purple, #6d3bea)",
  purpleDark: "var(--fl-desktop-purple-strong, #5b2fc7)",
  purpleSoft: "var(--fl-desktop-purple-soft, #f1edff)",
  green: "var(--fl-desktop-green, #039855)",
  greenSoft: "var(--fl-desktop-green-soft, #ecfdf3)",
  red: "var(--fl-desktop-red, #d92d20)",
  redSoft: "var(--fl-desktop-red-soft, #fef3f2)",
  amber: "var(--fl-desktop-amber, #dc6803)",
  amberSoft: "var(--fl-desktop-amber-soft, #fffaeb)",
  blue: "var(--fl-desktop-blue, #1570ef)",
  blueSoft: "var(--fl-desktop-blue-soft, #eff8ff)",
};

export function desktopThemeVariables(isDark: boolean) {
  return (
    isDark
      ? {
          "--fl-desktop-canvas": "#03040b",
          "--fl-desktop-surface": "#0b0e17",
          "--fl-desktop-surface-muted": "#101522",
          "--fl-desktop-border": "#252b3a",
          "--fl-desktop-border-soft": "#1a2030",
          "--fl-desktop-text": "#f8fafc",
          "--fl-desktop-text-secondary": "#d0d5dd",
          "--fl-desktop-muted": "#98a2b3",
          "--fl-desktop-faint": "#667085",
          "--fl-desktop-purple": "#9f5cff",
          "--fl-desktop-purple-strong": "#c4b5fd",
          "--fl-desktop-purple-soft": "#211638",
          "--fl-desktop-green": "#34d399",
          "--fl-desktop-green-soft": "#0b2c24",
          "--fl-desktop-red": "#fb7185",
          "--fl-desktop-red-soft": "#35141c",
          "--fl-desktop-amber": "#fbbf24",
          "--fl-desktop-amber-soft": "#33260a",
          "--fl-desktop-blue": "#60a5fa",
          "--fl-desktop-blue-soft": "#10264b",
        }
      : {
          "--fl-desktop-canvas": "#ffffff",
          "--fl-desktop-surface": "#ffffff",
          "--fl-desktop-surface-muted": "#f9fafb",
          "--fl-desktop-border": "#e4e7ec",
          "--fl-desktop-border-soft": "#eef0f3",
          "--fl-desktop-text": "#101828",
          "--fl-desktop-text-secondary": "#475467",
          "--fl-desktop-muted": "#667085",
          "--fl-desktop-faint": "#98a2b3",
          "--fl-desktop-purple": "#6d3bea",
          "--fl-desktop-purple-strong": "#5b2fc7",
          "--fl-desktop-purple-soft": "#f1edff",
          "--fl-desktop-green": "#039855",
          "--fl-desktop-green-soft": "#ecfdf3",
          "--fl-desktop-red": "#d92d20",
          "--fl-desktop-red-soft": "#fef3f2",
          "--fl-desktop-amber": "#dc6803",
          "--fl-desktop-amber-soft": "#fffaeb",
          "--fl-desktop-blue": "#1570ef",
          "--fl-desktop-blue-soft": "#eff8ff",
        }
  ) as never;
}

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export function DesktopPage({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.page, style]}>{children}</View>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderCopy}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          {title}
        </Text>
        <Text style={styles.pageDescription}>{description}</Text>
      </View>
      {actions ? <View style={styles.pageActions}>{actions}</View> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  icon = "plus",
  onPress,
  disabled = false,
}: {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        (pressed || disabled) && styles.controlPressed,
      ]}
    >
      <Feather name={icon} size={15} color="#ffffff" />
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && styles.controlPressed,
      ]}
    >
      {icon ? (
        <Feather name={icon} size={15} color={desktopPalette.textSecondary} />
      ) : null}
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function DesktopCard({
  children,
  nativeID,
  style,
}: {
  children: React.ReactNode;
  nativeID?: string;
  style?: ViewStyle;
}) {
  return <View nativeID={nativeID} style={[styles.card, style]}>{children}</View>;
}

export function SummaryMetricCard({
  label,
  value,
  detail,
  icon,
  tone = "purple",
}: {
  label: string;
  value: string;
  detail: string;
  icon: FeatherName;
  tone?: "purple" | "green" | "red" | "amber" | "blue";
}) {
  const tones = {
    purple: {
      color: desktopPalette.purple,
      background: desktopPalette.purpleSoft,
    },
    green: {
      color: desktopPalette.green,
      background: desktopPalette.greenSoft,
    },
    red: { color: desktopPalette.red, background: desktopPalette.redSoft },
    amber: {
      color: desktopPalette.amber,
      background: desktopPalette.amberSoft,
    },
    blue: { color: desktopPalette.blue, background: desktopPalette.blueSoft },
  }[tone];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text
          style={[
            styles.metricValue,
            {
              color: tone === "red" ? desktopPalette.red : desktopPalette.text,
            },
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Text style={styles.metricDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={[styles.metricIcon, { backgroundColor: tones.background }]}>
        <Feather name={icon} size={21} color={tones.color} />
      </View>
    </View>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.cardHeader}>
      <Text style={styles.cardTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function StatusBadge({
  label,
  tone = "purple",
}: {
  label: string;
  tone?: "purple" | "green" | "red" | "amber" | "blue" | "gray";
}) {
  const colors = {
    purple: [desktopPalette.purpleSoft, desktopPalette.purpleDark],
    green: [desktopPalette.greenSoft, desktopPalette.green],
    red: [desktopPalette.redSoft, desktopPalette.red],
    amber: [desktopPalette.amberSoft, desktopPalette.amber],
    blue: [desktopPalette.blueSoft, desktopPalette.blue],
    gray: [desktopPalette.surfaceMuted, desktopPalette.textSecondary],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors[0] }]}>
      <Text style={[styles.badgeText, { color: colors[1] }]}>{label}</Text>
    </View>
  );
}

export function DesktopSearch({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.desktopSearch}>
      <Feather name="search" size={15} color={desktopPalette.faint} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={desktopPalette.faint}
        style={styles.desktopSearchInput}
      />
    </View>
  );
}

export function FilterButton({
  label,
  onPress,
  active = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterButton,
        active && styles.filterButtonActive,
        pressed && styles.controlPressed,
      ]}
    >
      <Text
        style={[
          styles.filterButtonText,
          active && styles.filterButtonTextActive,
        ]}
      >
        {label}
      </Text>
      <Feather
        name="chevron-down"
        size={14}
        color={active ? desktopPalette.purple : desktopPalette.muted}
      />
    </Pressable>
  );
}

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.stateWrap}>
      <View style={styles.stateIcon}>
        <Feather name="inbox" size={22} color={desktopPalette.purple} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {action}
    </View>
  );
}

export function LoadingState({
  label = "Loading your data...",
}: {
  label?: string;
}) {
  return (
    <View style={styles.stateWrap}>
      <Text style={styles.stateTitle}>{label}</Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.stateWrap}>
      <Text style={[styles.stateTitle, { color: desktopPalette.red }]}>
        Something went wrong
      </Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {onRetry ? (
        <SecondaryButton
          label="Try again"
          icon="refresh-cw"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export const desktopTableStyles = StyleSheet.create({
  table: { overflow: "hidden" },
  header: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: desktopPalette.borderSoft,
    backgroundColor: desktopPalette.surfaceMuted,
  },
  headerText: {
    color: desktopPalette.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: desktopPalette.borderSoft,
  },
  cellText: {
    color: desktopPalette.textSecondary,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  cellStrong: {
    color: desktopPalette.text,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: desktopPalette.canvas, padding: 22 },
  pageHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    marginBottom: 14,
  },
  pageHeaderCopy: { flex: 1 },
  pageTitle: {
    color: desktopPalette.text,
    fontSize: 27,
    lineHeight: 33,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.7,
  },
  pageDescription: {
    color: desktopPalette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  pageActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryButton: {
    minHeight: 38,
    borderRadius: 7,
    backgroundColor: desktopPalette.purple,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  secondaryButton: {
    minHeight: 38,
    borderRadius: 7,
    backgroundColor: desktopPalette.surface,
    borderWidth: 1,
    borderColor: desktopPalette.border,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: {
    color: desktopPalette.textSecondary,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    borderColor: desktopPalette.border,
    borderRadius: 10,
    backgroundColor: desktopPalette.surface,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 106,
    borderWidth: 1,
    borderColor: desktopPalette.border,
    borderRadius: 10,
    backgroundColor: desktopPalette.surface,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metricCopy: { flex: 1, minWidth: 0 },
  metricLabel: {
    color: desktopPalette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  metricValue: {
    color: desktopPalette.text,
    fontSize: 22,
    lineHeight: 26,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.4,
  },
  metricDetail: {
    color: desktopPalette.muted,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 5,
  },
  metricIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeader: {
    minHeight: 49,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: desktopPalette.borderSoft,
  },
  cardTitle: {
    color: desktopPalette.text,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  desktopSearch: {
    flex: 1,
    minWidth: 180,
    maxWidth: 330,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: desktopPalette.border,
    borderRadius: 7,
    backgroundColor: desktopPalette.surface,
    paddingHorizontal: 11,
  },
  desktopSearchInput: {
    flex: 1,
    color: desktopPalette.text,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    outlineStyle: "none",
  } as never,
  filterButton: {
    minHeight: 38,
    minWidth: 118,
    borderWidth: 1,
    borderColor: desktopPalette.border,
    borderRadius: 7,
    backgroundColor: desktopPalette.surface,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  filterButtonActive: {
    borderColor: "#c7b9ff",
    backgroundColor: desktopPalette.purpleSoft,
  },
  filterButtonText: {
    color: desktopPalette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  filterButtonTextActive: { color: desktopPalette.purpleDark },
  toggleRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  toggleLabel: {
    color: desktopPalette.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  toggle: {
    width: 34,
    height: 20,
    padding: 2,
    borderRadius: 10,
    backgroundColor: desktopPalette.faint,
  },
  toggleOn: { backgroundColor: desktopPalette.purple },
  toggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  toggleKnobOn: { marginLeft: 14 },
  stateWrap: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  stateIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: desktopPalette.purpleSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  stateTitle: {
    color: desktopPalette.text,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  stateMessage: {
    maxWidth: 360,
    color: desktopPalette.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 5,
    marginBottom: 12,
  },
  controlPressed: { opacity: 0.68 },
});

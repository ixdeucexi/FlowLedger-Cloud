import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { desktopPalette as palette } from "@/components/desktop/DesktopUI";
import { apiFetch } from "@/lib/api";

interface MoneyHealthIssue {
  code: string;
  title: string;
  detail: string;
}

interface MoneyHealthRun {
  id: string;
  status: "clean" | "issues";
  issue_count: number;
  issues: MoneyHealthIssue[];
  triggered_by: "manual" | "nightly" | "deploy";
  checked_at: string;
}

interface MoneyHealthResponse {
  latest: MoneyHealthRun | null;
  history: MoneyHealthRun[];
  message?: string;
}

function checkedLabel(value?: string) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Checked recently";
  return `Checked ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function AdminMoneyHealth({ householdId, appearance = "theme" }: { householdId?: string | null; appearance?: "theme" | "desktop" | "settings" }) {
  const themeColors = useColors();
  const isDesktop = appearance !== "theme";
  const isSettings = appearance === "settings";
  const colors = isDesktop ? {
    ...themeColors,
    card: palette.surface,
    foreground: palette.text,
    mutedForeground: palette.muted,
    muted: palette.surfaceMuted,
    border: palette.border,
    primary: palette.purple,
    success: palette.green,
    destructive: palette.red,
    warning: palette.amber,
  } : themeColors;
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["admin-money-health", user?.id ?? "guest", householdId ?? "personal"];

  const request = async (method: "GET" | "POST") => {
    if (!session?.access_token) throw new Error("Please sign in again.");
    const response = await apiFetch("/api/admin/money-health", {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(householdId ? { "X-FlowLedger-Household-Id": householdId } : {}),
      },
    });
    const payload = await response.json().catch(() => ({})) as MoneyHealthResponse;
    if (!response.ok) throw new Error(payload.message || "Could not check Money Health.");
    return payload;
  };

  const health = useQuery({
    queryKey,
    queryFn: () => request("GET"),
    enabled: Boolean(session?.access_token),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
  const runCheck = useMutation({
    mutationFn: () => request("POST"),
    onSuccess: data => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const latest = health.data?.latest ?? null;
  const clean = latest?.status === "clean";
  const statusColor = clean ? colors.success : latest ? colors.warning : colors.mutedForeground;
  const statusBackground = isDesktop
    ? clean
      ? palette.greenSoft
      : latest
        ? palette.amberSoft
        : palette.surfaceMuted
    : statusColor + "18";
  const error = runCheck.error || health.error;

  return (
    <View style={[styles.card, isDesktop && styles.desktopCard, isSettings && styles.settingsCard, { backgroundColor: isSettings ? "transparent" : colors.card, borderColor: isDesktop ? colors.border : statusColor + "55" }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: statusBackground }]}>
          <Feather name={clean ? "check-circle" : "activity"} size={18} color={statusColor} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Money Health</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            {latest
              ? clean
                ? "Ledger, matches, and bank links look clean."
                : `${latest.issue_count} ${latest.issue_count === 1 ? "issue needs" : "issues need"} review.`
              : "Check ledger, matching, and bank-link integrity."}
          </Text>
          <Text style={[styles.checked, { color: colors.mutedForeground }]}>{checkedLabel(latest?.checked_at)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusBackground }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{clean ? "CLEAN" : latest ? "REVIEW" : "NEW"}</Text>
        </View>
      </View>

      {latest?.issues?.slice(0, 5).map(item => (
        <View key={`${latest.id}:${item.code}:${item.title}`} style={[styles.issue, { borderTopColor: colors.border }]}>
          <Feather name="alert-circle" size={15} color={colors.warning} />
          <View style={styles.issueCopy}>
            <Text style={[styles.issueTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.issueDetail, { color: colors.mutedForeground }]}>{item.detail}</Text>
          </View>
        </View>
      ))}

      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]}>
          {error instanceof Error ? error.message : "Could not check Money Health."}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Text style={[styles.readOnly, { color: colors.mutedForeground }]}>
          Read-only. Checks never change money.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run Money Health check"
          disabled={runCheck.isPending}
          onPress={() => runCheck.mutate()}
          style={({ pressed }) => [
            styles.button,
            isDesktop && styles.desktopButton,
            { backgroundColor: colors.primary, opacity: runCheck.isPending ? 0.55 : pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="refresh-cw" size={14} color={colors.primaryForeground} />
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {runCheck.isPending ? "Checking..." : "Run check"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  desktopCard: { borderRadius: 10 },
  settingsCard: { borderWidth: 0, borderRadius: 0, paddingHorizontal: 15, paddingVertical: 14 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: "800" },
  description: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  checked: { fontSize: 11, marginTop: 5 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  issue: { borderTopWidth: 1, paddingTop: 11, flexDirection: "row", alignItems: "flex-start", gap: 9 },
  issueCopy: { flex: 1 },
  issueTitle: { fontSize: 13, fontWeight: "800" },
  issueDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  error: { fontSize: 12, lineHeight: 17 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  readOnly: { flex: 1, fontSize: 11, lineHeight: 15 },
  button: { borderRadius: 12, paddingHorizontal: 13, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  desktopButton: { borderRadius: 7, minHeight: 38 },
  buttonText: { fontSize: 13, fontWeight: "800" },
});

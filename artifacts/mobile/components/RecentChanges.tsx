import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";
import { useRecentChanges } from "@/hooks/useRecentChanges";
import { formatRecentChangeValue, RECENT_CHANGE_DESTINATIONS, type RecentChange, type RecentChangeField } from "@/lib/recentChanges";

const actionLabels = { created: "Added", updated: "Changed", deleted: "Removed" } as const;
function changeTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown time";
}

function FieldDifference({ field }: { field: RecentChangeField }) {
  const c = useColors();
  return (
    <View style={[styles.difference, { borderColor: c.border }]}>
      <Text style={[styles.fieldLabel, { color: c.foreground }]}>{field.label}</Text>
      <View style={styles.values}>
        <View style={styles.valueColumn}>
          <Text style={[styles.valueLabel, { color: c.mutedForeground }]}>BEFORE</Text>
          <Text style={[styles.value, { color: c.mutedForeground }]}>{formatRecentChangeValue(field, field.before)}</Text>
        </View>
        <Feather name="arrow-right" size={15} color={c.mutedForeground} style={styles.arrow} />
        <View style={styles.valueColumn}>
          <Text style={[styles.valueLabel, { color: c.mutedForeground }]}>AFTER</Text>
          <Text style={[styles.value, { color: c.foreground }]}>{formatRecentChangeValue(field, field.after)}</Text>
        </View>
      </View>
    </View>
  );
}

export function RecentChanges() {
  const c = useColors();
  const router = useRouter();
  const history = useRecentChanges();
  const { canEditHousehold, undoRecentChange } = useBudget();
  const [review, setReview] = useState<{ id: string; scope: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ scope: string; text: string; error: boolean } | null>(null);
  const current = useRef({ scope: history.scopeKey, generation: 0, busy: false });
  if (current.current.scope !== history.scopeKey) {
    current.current = { scope: history.scopeKey, generation: current.current.generation + 1, busy: false };
  }
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; current.current.generation += 1; }; }, []);
  useEffect(() => { setReview(null); setBusy(null); setFeedback(null); }, [history.scopeKey]);
  const reviewId = review?.scope === history.scopeKey ? review.id : null;
  const visibleFeedback = feedback?.scope === history.scopeKey ? feedback : null;

  const undo = async (item: RecentChange) => {
    const scope = history.scopeKey;
    if (!scope || scope !== current.current.scope || !canEditHousehold || !item.canUndo || reviewId !== item.id || current.current.busy) return;
    const generation = ++current.current.generation;
    current.current.busy = true;
    setBusy(item.id);
    setFeedback(null);
    const isCurrent = () => mounted.current && current.current.scope === scope && current.current.generation === generation;
    try {
      await undoRecentChange(item.id);
      if (!isCurrent()) return;
      setReview(null);
      setFeedback({ scope, text: `Undid the change to ${item.label}.`, error: false });
      await history.refresh();
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({ scope, text: error instanceof Error ? error.message : "This change could not be undone. Try again.", error: true });
      await history.refresh();
    } finally {
      if (isCurrent()) { current.current.busy = false; setBusy(null); }
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.intro, { backgroundColor: c.primary + "10", borderColor: c.primary + "30" }]}>
        <View style={[styles.introIcon, { backgroundColor: c.primary + "18" }]}><Feather name="rotate-ccw" size={21} color={c.primary} /></View>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>A clear view of what changed</Text>
          <Text style={[styles.copy, { color: c.mutedForeground }]}>Review changes made by you, your household, or Flo. Undo is available when an edit can safely be reversed.</Text>
          <Text style={[styles.historyNote, { color: c.mutedForeground }]}>History starts with this update.</Text>
        </View>
      </View>
      <View style={styles.toolbar}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>Recent changes</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh recent changes" disabled={history.loading || Boolean(busy) || !history.ready || history.demoMode} onPress={() => void history.refresh()} style={({ pressed }) => [styles.secondary, { borderColor: c.border, backgroundColor: c.card, opacity: history.loading || busy || pressed ? 0.55 : 1 }]}>
          <Feather name="refresh-cw" size={14} color={c.primary} /><Text style={[styles.buttonText, { color: c.primary }]}>Refresh</Text>
        </Pressable>
      </View>
      {!history.ready ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Choose your active household and budget to view recent changes.</Text> : null}
      {history.demoMode ? <Text style={[styles.copy, { color: c.mutedForeground }]}>Recent changes are available in your signed-in plan. Demo changes stay separate.</Text> : null}
      {!canEditHousehold && history.ready ? <Text style={[styles.copy, { color: c.mutedForeground }]}>You have view-only access. A household editor can undo eligible changes.</Text> : null}
      {visibleFeedback ? <Text accessibilityRole={visibleFeedback.error ? "alert" : undefined} accessibilityLiveRegion="polite" style={[styles.feedback, { color: visibleFeedback.error ? c.destructive : c.success }]}>{visibleFeedback.text}</Text> : null}
      {history.error ? (
        <View style={[styles.notice, { borderColor: c.destructive + "50", backgroundColor: c.card }]}>
          <Text accessibilityRole="alert" style={[styles.copy, { color: c.destructive }]}>{history.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry loading recent changes" disabled={history.loading || history.loadingMore || Boolean(busy)} onPress={() => void history.retry()} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.buttonText, { color: c.primary }]}>Try again</Text></Pressable>
        </View>
      ) : null}
      {history.loading && history.items.length === 0 ? <View accessibilityLabel="Loading recent changes" style={styles.loading}><ActivityIndicator color={c.primary} /><Text style={[styles.copy, { color: c.mutedForeground }]}>Loading recent changes…</Text></View> : null}
      {history.ready && !history.demoMode && !history.loading && !history.error && history.items.length === 0 ? (
        <View style={[styles.empty, { borderColor: c.border, backgroundColor: c.card }]}>
          <Feather name="clock" size={28} color={c.primary} />
          <Text style={[styles.title, { color: c.foreground }]}>Your next changes will appear here</Text>
          <Text style={[styles.copy, { color: c.mutedForeground }]}>Add or edit an item in your plan to start your history.</Text>
        </View>
      ) : null}
      {history.items.map(item => {
        const reviewing = reviewId === item.id;
        const fields = reviewing ? item.changes : item.changes.slice(0, 2);
        return (
          <View key={item.id} accessibilityLabel={`Recent change: ${item.label}`} style={[styles.card, { backgroundColor: c.card, borderColor: reviewing ? c.primary : c.border }]}>
            <View style={styles.row}>
              <View style={[styles.changeIcon, { backgroundColor: item.undoneAt ? c.success + "12" : c.primary + "14" }]}><Feather name={item.undoneAt ? "check-circle" : item.action === "deleted" ? "trash-2" : item.action === "created" ? "plus" : "edit-3"} size={18} color={item.undoneAt ? c.success : c.primary} /></View>
              <View style={styles.flex}>
                <Text style={[styles.itemName, { color: c.foreground }]}>{item.label}</Text>
                <Text style={[styles.meta, { color: c.mutedForeground }]}>{actionLabels[item.action]} · {item.source === "flo" ? `Flo · ${item.actorLabel}` : item.actorLabel} · {changeTime(item.createdAt)}</Text>
              </View>
              {item.undoneAt ? <Text style={[styles.undone, { color: c.success }]}>Undone</Text> : null}
            </View>
            {fields.map((field, index) => <FieldDifference key={`${field.key}-${index}`} field={field} />)}
            {!reviewing && item.changes.length > fields.length ? <Text style={[styles.meta, { color: c.mutedForeground }]}>{item.changes.length - fields.length} more field{item.changes.length - fields.length === 1 ? "" : "s"} changed</Text> : null}
            {!item.canUndo ? <Text style={[styles.reason, { color: c.mutedForeground }]}>{item.undoReason ?? "Undo is not available for this change. Use the item’s dedicated controls."}</Text> : null}
            {reviewing && item.canUndo ? (
              <View accessibilityLabel={`Review undo for ${item.label}`} style={[styles.confirmation, { borderColor: c.primary + "50", backgroundColor: c.primary + "08" }]}>
                <Text style={[styles.itemName, { color: c.foreground }]}>Undo this change?</Text>
                <Text style={[styles.copy, { color: c.mutedForeground }]}>{item.action === "created" ? "This removes the added item from your plan." : item.action === "deleted" ? "This restores the removed item to your plan." : "This restores the Before values shown above."} FlowLedger checks for newer changes before saving.</Text>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Cancel undo for ${item.label}`} disabled={Boolean(busy)} onPress={() => { setReview(null); setFeedback(null); }} style={[styles.secondary, { backgroundColor: c.card, borderColor: c.border }]}><Text style={[styles.buttonText, { color: c.foreground }]}>Cancel</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Confirm undo for ${item.label}`} disabled={Boolean(busy) || !canEditHousehold || history.loading} onPress={() => void undo(item)} style={({ pressed }) => [styles.primary, { backgroundColor: c.primary, opacity: busy || history.loading || pressed ? 0.6 : 1 }]}><Feather name="rotate-ccw" size={14} color={c.primaryForeground} /><Text style={[styles.buttonText, { color: c.primaryForeground }]}>{busy === item.id ? "Undoing…" : "Undo change"}</Text></Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                {item.canUndo && canEditHousehold ? <Pressable accessibilityRole="button" accessibilityLabel={`Review undo for ${item.label}`} disabled={Boolean(busy) || history.loading} onPress={() => { if (history.scopeKey) setReview({ id: item.id, scope: history.scopeKey }); setFeedback(null); }} style={[styles.secondary, { backgroundColor: c.primary + "12", borderColor: c.primary + "40", opacity: busy || history.loading ? 0.5 : 1 }]}><Feather name="rotate-ccw" size={14} color={c.primary} /><Text style={[styles.buttonText, { color: c.primary }]}>Review undo</Text></Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`${RECENT_CHANGE_DESTINATIONS[item.entityType]} for ${item.label}`} disabled={Boolean(busy)} onPress={() => router.push(item.route as never)} style={[styles.secondary, { borderColor: c.border }]}><Text style={[styles.buttonText, { color: c.foreground }]}>{RECENT_CHANGE_DESTINATIONS[item.entityType]}</Text><Feather name="arrow-up-right" size={13} color={c.mutedForeground} /></Pressable>
              </View>
            )}
          </View>
        );
      })}
      {history.cursor ? <Pressable accessibilityRole="button" accessibilityLabel="Load more recent changes" disabled={history.loading || history.loadingMore || Boolean(busy)} onPress={() => void history.loadMore()} style={[styles.secondary, styles.loadMore, { borderColor: c.border, backgroundColor: c.card, opacity: history.loadingMore || busy ? 0.6 : 1 }]}><Text style={[styles.buttonText, { color: c.primary }]}>{history.loadingMore ? "Loading…" : "Load more"}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 }, flex: { flex: 1, minWidth: 0 }, row: { flexDirection: "row", alignItems: "center", gap: 10 },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 20, borderWidth: 1 },
  introIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 17, lineHeight: 23 }, copy: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  historyNote: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 17, marginTop: 7 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  secondary: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primary: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 12 }, feedback: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 20 },
  notice: { padding: 14, borderRadius: 15, borderWidth: 1, gap: 10 }, loading: { padding: 22, gap: 12, alignItems: "center" },
  empty: { padding: 28, borderRadius: 20, borderWidth: 1, gap: 12, alignItems: "center" }, card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  changeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemName: { fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 20 }, meta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17 },
  undone: { fontFamily: "Inter_700Bold", fontSize: 11 }, difference: { borderTopWidth: 1, paddingTop: 10, gap: 6 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 }, values: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  valueColumn: { flex: 1, minWidth: 0, gap: 4 }, valueLabel: { fontFamily: "Inter_600SemiBold", fontSize: 9, letterSpacing: 0.8 },
  value: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 }, arrow: { marginTop: 15 }, reason: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9 }, confirmation: { padding: 14, borderWidth: 1, borderRadius: 15, gap: 10 },
  loadMore: { alignSelf: "center", minWidth: 150 },
});

import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import type { SearchResultKind, UniversalSearchResult } from "@/lib/universalSearch";

type Props = {
  visible: boolean;
  mode: "search" | "commands";
  query: string;
  results: UniversalSearchResult[];
  loading: boolean;
  onModeChange: (mode: "search" | "commands") => void;
  onQueryChange: (query: string) => void;
  onSelect: (result: UniversalSearchResult) => void;
  onClose: () => void;
};

const KIND_ORDER: SearchResultKind[] = ["Command", "Bill", "Debt", "Goal", "Activity", "Category", "Report", "Review Center", "Settings"];

function HighlightedText({ text, query, color }: { text: string; query: string; color: string }) {
  const normalized = query.trim();
  if (!normalized) return <Text style={{ color }}>{text}</Text>;
  const index = text.toLowerCase().indexOf(normalized.toLowerCase());
  if (index < 0) return <Text style={{ color }}>{text}</Text>;
  return (
    <Text style={{ color }}>
      {text.slice(0, index)}
      <Text style={styles.highlight}>{text.slice(index, index + normalized.length)}</Text>
      {text.slice(index + normalized.length)}
    </Text>
  );
}

export function UniversalSearchModal(props: Props) {
  const { visible, mode, query, results, loading, onModeChange, onQueryChange, onSelect, onClose } = props;
  const c = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 700;
  const [selectedIndex, setSelectedIndex] = useState(0);
  useBackDismiss(visible, onClose);

  useEffect(() => setSelectedIndex(0), [mode, query]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex(index => results.length ? (index + 1) % results.length : 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(index => results.length ? (index - 1 + results.length) % results.length : 0);
      } else if (event.key === "Enter" && results[selectedIndex]) {
        event.preventDefault();
        onSelect(results[selectedIndex]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onSelect, results, selectedIndex, visible]);

  const grouped = useMemo(() => KIND_ORDER.map(kind => ({
    kind,
    results: results.map((result, index) => ({ result, index })).filter(item => item.result.kind === kind),
  })).filter(group => group.results.length > 0), [results]);

  const prompt = mode === "commands" ? "Search actions…" : "Search bills, debts, goals, activity…";

  return (
    <Modal visible={visible} transparent animationType={compact ? "slide" : "fade"} onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, compact && styles.backdropCompact]} onPress={onClose}>
        <Pressable
          onPress={event => event.stopPropagation()}
          style={[
            styles.dialog,
            compact && styles.dialogCompact,
            {
              backgroundColor: c.isDark ? "#080c17" : "#ffffff",
              borderColor: c.border,
              paddingTop: compact ? Math.max(insets.top, 14) : 0,
              paddingBottom: compact ? Math.max(insets.bottom, 14) : 0,
            },
          ]}
        >
          <View style={[styles.topBar, { borderBottomColor: c.border }]}>
            <View style={styles.modeTabs}>
              {(["search", "commands"] as const).map(item => (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === item }}
                  onPress={() => onModeChange(item)}
                  style={[styles.modeTab, mode === item && { backgroundColor: c.primary + "1A" }]}
                >
                  <Feather name={item === "search" ? "search" : "zap"} size={15} color={mode === item ? c.primary : c.mutedForeground} />
                  <Text style={[styles.modeText, { color: mode === item ? c.primary : c.mutedForeground }]}>{item === "search" ? "Search" : "Actions"}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={21} color={c.mutedForeground} />
            </Pressable>
          </View>
          <View style={[styles.searchBox, { borderColor: c.border, backgroundColor: c.input }]}>
            <Feather name="search" size={19} color={c.mutedForeground} />
            <TextInput
              autoFocus
              accessibilityLabel={prompt}
              value={query}
              onChangeText={onQueryChange}
              placeholder={prompt}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.input, { color: c.foreground }]}
            />
            {loading ? <ActivityIndicator size="small" color={c.primary} /> : null}
            {query ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onQueryChange("")} hitSlop={8}>
                <Feather name="x-circle" size={18} color={c.mutedForeground} />
              </Pressable>
            ) : null}
            {!compact ? <View style={[styles.shortcut, { borderColor: c.border }]}><Text style={[styles.shortcutText, { color: c.mutedForeground }]}>ESC</Text></View> : null}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results} showsVerticalScrollIndicator={false}>
            {grouped.map(group => (
              <View key={group.kind} style={styles.group}>
                <Text style={[styles.groupLabel, { color: c.mutedForeground }]}>{group.kind}</Text>
                {group.results.map(({ result, index }) => {
                  const selected = index === selectedIndex;
                  return (
                    <Pressable
                      key={`${result.kind}:${result.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${result.kind}: ${result.title}. ${result.subtitle}`}
                      onHoverIn={() => setSelectedIndex(index)}
                      onPress={() => onSelect(result)}
                      style={({ pressed }) => [
                        styles.resultRow,
                        { backgroundColor: selected ? c.primary + "16" : pressed ? c.muted : "transparent" },
                      ]}
                    >
                      <View style={[styles.resultIcon, { backgroundColor: c.primary + "15" }]}>
                        <Feather name={result.icon as React.ComponentProps<typeof Feather>["name"]} size={17} color={c.primary} />
                      </View>
                      <View style={styles.resultCopy}>
                        <Text style={styles.resultTitle} numberOfLines={1}><HighlightedText text={result.title} query={query} color={c.foreground} /></Text>
                        <Text style={[styles.resultSubtitle, { color: c.mutedForeground }]} numberOfLines={1}>{result.subtitle}</Text>
                      </View>
                      <Feather name="arrow-up-right" size={16} color={selected ? c.primary : c.mutedForeground} />
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {results.length === 0 && !loading ? (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: c.muted }]}><Feather name="search" size={24} color={c.mutedForeground} /></View>
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>{query ? "No matches found" : mode === "commands" ? "Start with a quick action" : "Search your FlowLedger plan"}</Text>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>{query ? "Try a merchant, bill, debt, goal, category, report, or setting." : "Results are limited to this signed-in household."}</Text>
              </View>
            ) : null}
          </ScrollView>
          {!compact ? (
            <View style={[styles.footer, { borderTopColor: c.border }]}>
              <Text style={[styles.footerText, { color: c.mutedForeground }]}>↑↓ Navigate</Text>
              <Text style={[styles.footerText, { color: c.mutedForeground }]}>Enter Open</Text>
              <Text style={[styles.footerText, { color: c.mutedForeground }]}>⌘/Ctrl K Actions</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.76)", justifyContent: "flex-start", alignItems: "center", paddingTop: 80, paddingHorizontal: 24 },
  backdropCompact: { padding: 0, justifyContent: "flex-end" },
  dialog: { width: "100%", maxWidth: 760, maxHeight: "80%", borderWidth: 1, borderRadius: 22, overflow: "hidden", shadowColor: "#7c3aed", shadowOpacity: 0.26, shadowRadius: 34, shadowOffset: { width: 0, height: 18 } },
  dialogCompact: { maxWidth: "100%", maxHeight: "100%", height: "100%", borderRadius: 0 },
  topBar: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modeTabs: { flexDirection: "row", gap: 6 },
  modeTab: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 7 },
  modeText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  searchBox: { margin: 16, minHeight: 54, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, minWidth: 0, fontFamily: "Inter_600SemiBold", fontSize: 16, paddingVertical: 12, outlineStyle: "none" } as never,
  shortcut: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4 },
  shortcutText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  results: { paddingHorizontal: 12, paddingBottom: 18 },
  group: { marginBottom: 12 },
  groupLabel: { fontFamily: "Inter_800ExtraBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.1, marginHorizontal: 12, marginBottom: 5 },
  resultRow: { minHeight: 62, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 12 },
  resultIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  highlight: { fontFamily: "Inter_800ExtraBold", textDecorationLine: "underline" },
  resultSubtitle: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 3 },
  empty: { alignItems: "center", paddingHorizontal: 26, paddingVertical: 54 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 18, textAlign: "center" },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 420, marginTop: 7 },
  footer: { minHeight: 46, borderTopWidth: 1, flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 20 },
  footerText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
});

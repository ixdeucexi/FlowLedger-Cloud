import { Feather } from "@expo/vector-icons";
import React, { useDeferredValue, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { searchFloHistory } from "@/lib/floExperience";
import type { FloConversation } from "@/lib/floChat";
import type { FloPreferences } from "@/lib/floPreferences";

type Props = {
  conversations: FloConversation[];
  activeId: string | null;
  disabled?: boolean;
  desktop?: boolean;
  householdName: string;
  preferences: FloPreferences;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onExport: () => Promise<void>;
  onSearchHistory: (query: string) => Promise<Set<string>>;
  onPreferencesChange: (preferences: FloPreferences) => void;
};

export function FloConversationBar(props: Props) {
  const c = useColors();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [renameTarget, setRenameTarget] = useState<FloConversation | null>(null);
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FloConversation | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [preferenceDraft, setPreferenceDraft] = useState(props.preferences.preferenceNote);
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set());
  const titleMatches = searchFloHistory(props.conversations, deferredSearch);
  const filtered = deferredSearch.trim()
    ? props.conversations.filter(item => titleMatches.includes(item) || contentMatches.has(item.id))
    : props.conversations;

  useEffect(() => setPreferenceDraft(props.preferences.preferenceNote), [props.preferences.preferenceNote]);

  useEffect(() => {
    let cancelled = false;
    const query = deferredSearch.trim();
    if (!query) {
      setContentMatches(new Set());
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => {
      void props.onSearchHistory(query).then(matches => {
        if (!cancelled) setContentMatches(matches);
      }).catch(() => {
        if (!cancelled) setContentMatches(new Set());
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deferredSearch, props.onSearchHistory]);

  const choose = (id: string) => {
    props.onSelect(id);
    if (!props.desktop) setDrawerOpen(false);
  };

  const runDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await props.onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      setActionError("This chat could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const runDeleteAll = async () => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await props.onDeleteAll();
      setConfirmDeleteAll(false);
      setDrawerOpen(false);
    } catch {
      setActionError("Flo history could not be cleared. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <View style={[styles.panel, props.desktop && styles.panelDesktop, { backgroundColor: c.background, borderColor: c.border }]}>
      <View style={styles.panelHeader}>
        <View style={styles.panelTitleWrap}>
          <Text style={[styles.panelEyebrow, { color: c.primary }]}>PRIVATE HISTORY</Text>
          <Text style={[styles.panelTitle, { color: c.foreground }]}>{props.householdName}</Text>
        </View>
        {!props.desktop ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close Flo history" onPress={() => setDrawerOpen(false)} style={[styles.iconButton, { backgroundColor: c.muted }]}>
            <Feather name="x" size={18} color={c.foreground} />
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" disabled={props.disabled} onPress={() => { props.onNew(); if (!props.desktop) setDrawerOpen(false); }} style={[styles.newButton, { backgroundColor: c.primary, opacity: props.disabled ? 0.5 : 1 }]}>
        <Feather name="plus" size={16} color={c.primaryForeground} />
        <Text style={[styles.newText, { color: c.primaryForeground }]}>New conversation</Text>
      </Pressable>
      <View style={[styles.searchWrap, { backgroundColor: c.card, borderColor: c.border }]}>
        <Feather name="search" size={15} color={c.mutedForeground} />
        <TextInput accessibilityLabel="Search Flo history" value={search} onChangeText={setSearch} placeholder="Search private history" placeholderTextColor={c.mutedForeground} style={[styles.searchInput, { color: c.foreground }]} />
        {search ? <Pressable accessibilityRole="button" accessibilityLabel="Clear history search" onPress={() => setSearch("")} style={styles.clearSearch}><Feather name="x" size={14} color={c.mutedForeground} /></Pressable> : null}
      </View>
      <ScrollView style={styles.historyList} contentContainerStyle={styles.historyContent} keyboardShouldPersistTaps="handled">
        {filtered.length ? filtered.map(conversation => {
          const selected = conversation.id === props.activeId;
          return (
            <View key={conversation.id} style={[styles.item, { backgroundColor: selected ? c.primary + "16" : c.card, borderColor: selected ? c.primary : c.border }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${conversation.title}`} disabled={props.disabled} onPress={() => choose(conversation.id)} style={styles.itemMain}>
                <Text numberOfLines={1} style={[styles.itemTitle, { color: selected ? c.primary : c.foreground }]}>{conversation.title}</Text>
                <Text numberOfLines={1} style={[styles.itemMeta, { color: c.mutedForeground }]}>{conversation.messageCount} messages</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${conversation.title}`} disabled={props.disabled} onPress={() => { setRenameTarget(conversation); setTitle(conversation.title); }} style={styles.itemIconButton}>
                <Feather name="edit-2" size={14} color={c.mutedForeground} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${conversation.title}`} disabled={props.disabled} onPress={() => { setActionError(""); setDeleteTarget(conversation); }} style={styles.itemIconButton}>
                <Feather name="trash-2" size={14} color={c.destructive} />
              </Pressable>
            </View>
          );
        }) : <Text style={[styles.empty, { color: c.mutedForeground }]}>{search ? "No conversations match your search." : "Your private Flo conversations will appear here."}</Text>}
      </ScrollView>
      <View style={[styles.controls, { borderTopColor: c.border }]}>
        <SettingRow label="Save conversation history" detail="Turn off to keep new chats out of history." value={props.preferences.historyEnabled} onValueChange={value => props.onPreferencesChange({ ...props.preferences, historyEnabled: value })} />
        <SettingRow label="Remember one Flo preference" detail="Opt in to one household-scoped preference you choose." value={props.preferences.rememberPreferences} onValueChange={value => {
          if (!value) setPreferenceDraft("");
          props.onPreferencesChange({ ...props.preferences, rememberPreferences: value, preferenceNote: value ? preferenceDraft.trim().slice(0, 240) : "" });
        }} />
        {props.preferences.rememberPreferences ? (
          <View>
            <Text style={[styles.preferenceLabel, { color: c.mutedForeground }]}>WHAT FLO SHOULD REMEMBER</Text>
            <TextInput
              accessibilityLabel="Preference for Flo to remember"
              value={preferenceDraft}
              onChangeText={value => setPreferenceDraft(value.slice(0, 240))}
              onBlur={() => props.onPreferencesChange({ ...props.preferences, preferenceNote: preferenceDraft.trim().slice(0, 240) })}
              placeholder="Example: Keep explanations short and focus on debt first."
              placeholderTextColor={c.mutedForeground}
              maxLength={240}
              multiline
              style={[styles.preferenceInput, { color: c.foreground, backgroundColor: c.card, borderColor: c.border }]}
            />
            <Text style={[styles.preferenceCount, { color: c.mutedForeground }]}>{preferenceDraft.length}/240</Text>
          </View>
        ) : null}
        <View style={styles.historyActions}>
          <Pressable accessibilityRole="button" disabled={!props.conversations.length || busy} onPress={() => void props.onExport()} style={[styles.secondaryButton, { backgroundColor: c.muted, opacity: props.conversations.length ? 1 : 0.5 }]}>
            <Feather name="download" size={14} color={c.foreground} /><Text style={[styles.secondaryText, { color: c.foreground }]}>Export</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!props.conversations.length || busy} onPress={() => setConfirmDeleteAll(true)} style={[styles.secondaryButton, { backgroundColor: c.destructive + "14", opacity: props.conversations.length ? 1 : 0.5 }]}>
            <Feather name="trash-2" size={14} color={c.destructive} /><Text style={[styles.secondaryText, { color: c.destructive }]}>Delete all</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <>
      {props.desktop ? panel : (
        <View style={[styles.mobileBar, { backgroundColor: c.background, borderColor: c.border }]}>
          <Pressable accessibilityRole="button" disabled={props.disabled} onPress={props.onNew} style={[styles.compactNew, { backgroundColor: c.primary, opacity: props.disabled ? 0.5 : 1 }]}>
            <Feather name="plus" size={15} color={c.primaryForeground} /><Text style={[styles.newText, { color: c.primaryForeground }]}>New</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open private Flo history" onPress={() => setDrawerOpen(true)} style={[styles.historyButton, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="clock" size={15} color={c.primary} /><Text numberOfLines={1} style={[styles.activeTitle, { color: c.foreground }]}>{props.conversations.find(item => item.id === props.activeId)?.title ?? "Private history"}</Text><Feather name="chevron-up" size={15} color={c.mutedForeground} />
          </Pressable>
        </View>
      )}

      <Modal visible={!props.desktop && drawerOpen} transparent animationType="slide" onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={styles.drawerOverlay} onPress={() => setDrawerOpen(false)}><Pressable style={styles.drawer} onPress={() => undefined}>{panel}</Pressable></Pressable>
      </Modal>
      <ConfirmDialog visible={Boolean(renameTarget)} title="Rename Flo conversation" error={actionError} c={c} onClose={() => setRenameTarget(null)}>
        <TextInput accessibilityLabel="Conversation title" value={title} onChangeText={setTitle} autoFocus maxLength={80} style={[styles.dialogInput, { color: c.foreground, backgroundColor: c.muted, borderColor: c.border }]} />
        <View style={styles.dialogActions}><DialogButton label="Cancel" onPress={() => setRenameTarget(null)} /><DialogButton primary label="Save" disabled={!title.trim()} onPress={() => { if (!renameTarget || !title.trim()) return; void props.onRename(renameTarget.id, title).then(() => setRenameTarget(null)); }} /></View>
      </ConfirmDialog>
      <ConfirmDialog visible={Boolean(deleteTarget)} title="Delete this conversation?" body="This conversation and all of its messages will be permanently deleted." error={actionError} c={c} onClose={() => !busy && setDeleteTarget(null)}>
        <View style={styles.dialogActions}><DialogButton label="Cancel" disabled={busy} onPress={() => setDeleteTarget(null)} /><DialogButton destructive label={busy ? "Deleting..." : "Delete"} disabled={busy} onPress={() => void runDelete()} /></View>
      </ConfirmDialog>
      <ConfirmDialog visible={confirmDeleteAll} title="Delete all Flo history?" body="Every private conversation for this household will be permanently deleted." error={actionError} c={c} onClose={() => !busy && setConfirmDeleteAll(false)}>
        <View style={styles.dialogActions}><DialogButton label="Cancel" disabled={busy} onPress={() => setConfirmDeleteAll(false)} /><DialogButton destructive label={busy ? "Deleting..." : "Delete all"} disabled={busy} onPress={() => void runDeleteAll()} /></View>
      </ConfirmDialog>
    </>
  );
}

function SettingRow({ label, detail, value, onValueChange }: { label: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const c = useColors();
  return <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={[styles.settingLabel, { color: c.foreground }]}>{label}</Text><Text style={[styles.settingDetail, { color: c.mutedForeground }]}>{detail}</Text></View><Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{ false: c.muted, true: c.primary + "80" }} thumbColor={value ? c.primary : c.mutedForeground} /></View>;
}

function ConfirmDialog({ visible, title, body, error, c, onClose, children }: { visible: boolean; title: string; body?: string; error: string; c: ReturnType<typeof useColors>; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.dialogOverlay} onPress={onClose}><Pressable style={[styles.dialog, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}><Text style={[styles.dialogTitle, { color: c.foreground }]}>{title}</Text>{body ? <Text style={[styles.dialogBody, { color: c.mutedForeground }]}>{body}</Text> : null}{error ? <Text style={[styles.dialogError, { color: c.destructive }]}>{error}</Text> : null}{children}</Pressable></Pressable></Modal>;
}

function DialogButton({ label, primary, destructive, disabled, onPress }: { label: string; primary?: boolean; destructive?: boolean; disabled?: boolean; onPress: () => void }) {
  const c = useColors();
  const backgroundColor = destructive ? c.destructive : primary ? c.primary : c.muted;
  const color = destructive || primary ? "#fff" : c.foreground;
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.dialogButton, { backgroundColor, opacity: disabled ? 0.5 : 1 }]}><Text style={[styles.dialogButtonText, { color }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  mobileBar: { minHeight: 58, paddingHorizontal: 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  compactNew: { minHeight: 44, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 5 },
  historyButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11 },
  activeTitle: { flex: 1, fontSize: 12, fontFamily: "Inter_700Bold" },
  panel: { flex: 1, width: "100%", borderRightWidth: 1, padding: 14 },
  panelDesktop: { width: 292, maxWidth: 292 },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  panelTitleWrap: { flex: 1 },
  panelEyebrow: { fontSize: 9, letterSpacing: 1.1, fontFamily: "Inter_800ExtraBold" },
  panelTitle: { fontSize: 17, marginTop: 2, fontFamily: "Inter_800ExtraBold" },
  iconButton: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  newButton: { minHeight: 44, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  newText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  searchWrap: { minHeight: 46, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, marginTop: 10 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 12, fontFamily: "Inter_500Medium" },
  clearSearch: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  historyList: { flex: 1, marginTop: 10 },
  historyContent: { gap: 7, paddingBottom: 10 },
  item: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  itemMain: { flex: 1, justifyContent: "center", minHeight: 56 },
  itemIconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  itemMeta: { fontSize: 10, marginTop: 3, fontFamily: "Inter_500Medium" },
  empty: { padding: 18, textAlign: "center", fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  controls: { borderTopWidth: 1, paddingTop: 10, gap: 10 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingCopy: { flex: 1 },
  settingLabel: { fontSize: 11, fontFamily: "Inter_700Bold" },
  settingDetail: { fontSize: 9, lineHeight: 13, marginTop: 2, fontFamily: "Inter_400Regular" },
  preferenceLabel: { fontSize: 8, letterSpacing: 0.8, marginBottom: 5, fontFamily: "Inter_800ExtraBold" },
  preferenceInput: { minHeight: 68, maxHeight: 108, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium", textAlignVertical: "top" },
  preferenceCount: { fontSize: 8, textAlign: "right", marginTop: 3, fontFamily: "Inter_500Medium" },
  historyActions: { flexDirection: "row", gap: 8 },
  secondaryButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  secondaryText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  drawerOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", justifyContent: "flex-end" },
  drawer: { height: "82%", borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: "hidden" },
  dialogOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.68)", alignItems: "center", justifyContent: "center", padding: 22 },
  dialog: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 20, padding: 18 },
  dialogTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  dialogBody: { fontSize: 12, lineHeight: 18, marginTop: 7, fontFamily: "Inter_500Medium" },
  dialogError: { fontSize: 11, marginTop: 8, fontFamily: "Inter_700Bold" },
  dialogInput: { minHeight: 48, borderWidth: 1, borderRadius: 13, marginTop: 14, paddingHorizontal: 12, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 14 },
  dialogButton: { minHeight: 44, borderRadius: 12, justifyContent: "center", paddingHorizontal: 16 },
  dialogButtonText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
});

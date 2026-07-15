import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { FloConversation } from "@/lib/floChat";

export function FloConversationBar({
  conversations,
  activeId,
  disabled,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  conversations: FloConversation[];
  activeId: string | null;
  disabled?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const c = useColors();
  const [renameTarget, setRenameTarget] = useState<FloConversation | null>(null);
  const [title, setTitle] = useState("");

  const startRename = (conversation: FloConversation) => {
    setRenameTarget(conversation);
    setTitle(conversation.title);
  };

  const confirmDelete = (conversation: FloConversation) => {
    Alert.alert("Delete private Flo chat?", `“${conversation.title}” and its messages will be permanently deleted.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void onDelete(conversation.id) },
    ]);
  };

  return (
    <>
      <View style={[styles.root, { borderColor: c.border, backgroundColor: c.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new Flo chat"
          disabled={disabled}
          onPress={onNew}
          style={[styles.newButton, { backgroundColor: c.primary, opacity: disabled ? 0.5 : 1 }]}
        >
          <Feather name="plus" size={15} color={c.primaryForeground} />
          <Text style={[styles.newText, { color: c.primaryForeground }]}>New</Text>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
          {conversations.map(conversation => {
            const selected = conversation.id === activeId;
            return (
              <View key={conversation.id} style={[styles.item, { backgroundColor: selected ? c.primary + "18" : c.card, borderColor: selected ? c.primary : c.border }]}>
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSelect(conversation.id)} style={styles.titleButton}>
                  <Text numberOfLines={1} style={[styles.itemTitle, { color: selected ? c.primary : c.foreground }]}>{conversation.title}</Text>
                </Pressable>
                {selected ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel="Rename chat" disabled={disabled} onPress={() => startRename(conversation)} hitSlop={8}>
                      <Feather name="edit-2" size={13} color={c.mutedForeground} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Delete chat" disabled={disabled} onPress={() => confirmDelete(conversation)} hitSlop={8}>
                      <Feather name="trash-2" size={13} color={c.destructive} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <Modal visible={Boolean(renameTarget)} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <Pressable style={styles.overlay} onPress={() => setRenameTarget(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => undefined}>
            <Text style={[styles.dialogTitle, { color: c.foreground }]}>Rename Flo chat</Text>
            <TextInput
              accessibilityLabel="Chat title"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              autoFocus
              style={[styles.input, { color: c.foreground, backgroundColor: c.muted, borderColor: c.border }]}
            />
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => setRenameTarget(null)} style={[styles.action, { backgroundColor: c.muted }]}>
                <Text style={[styles.actionText, { color: c.mutedForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!title.trim()}
                onPress={() => {
                  if (!renameTarget || !title.trim()) return;
                  void onRename(renameTarget.id, title).then(() => setRenameTarget(null));
                }}
                style={[styles.action, { backgroundColor: c.primary, opacity: title.trim() ? 1 : 0.5 }]}
              >
                <Text style={[styles.actionText, { color: c.primaryForeground }]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { minHeight: 54, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 8 },
  newButton: { minHeight: 38, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12 },
  newText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  list: { gap: 8, alignItems: "center", paddingRight: 10 },
  item: { height: 38, maxWidth: 230, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10 },
  titleButton: { maxWidth: 150 },
  itemTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 20, padding: 18 },
  dialogTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 13, marginTop: 14, paddingHorizontal: 12, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 },
  action: { minHeight: 42, borderRadius: 12, justifyContent: "center", paddingHorizontal: 16 },
  actionText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});

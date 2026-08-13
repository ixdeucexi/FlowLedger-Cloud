import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { InAppNotification, InAppNotificationTone } from "@/lib/notificationCenter";

type Props = {
  visible: boolean;
  notifications: InAppNotification[];
  readIds: string[];
  onOpen: (notification: InAppNotification) => void;
  onDismiss: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
};

const ICONS: Record<InAppNotification["type"], React.ComponentProps<typeof Feather>["name"]> = {
  bill: "file-text",
  forecast: "alert-triangle",
  goal: "target",
  debt: "credit-card",
  review: "check-square",
};

function timestampLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NotificationCenterModal({ visible, notifications, readIds, onOpen, onDismiss, onMarkAllRead, onClose }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 700;
  const reduceMotion = useReducedMotion();
  const read = new Set(readIds);
  const unread = notifications.filter(item => !read.has(item.id)).length;
  useBackDismiss(visible, onClose);

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, visible]);

  const toneColor = (tone: InAppNotificationTone) => tone === "risk" ? c.destructive : tone === "watch" ? c.warning : tone === "safe" ? c.success : c.primary;

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : compact ? "slide" : "fade"} onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, compact && styles.backdropCompact]} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          onPress={event => event.stopPropagation()}
          style={[
            styles.dialog,
            compact && styles.dialogCompact,
            { backgroundColor: c.isDark ? "#080c17" : "#ffffff", borderColor: c.border, paddingTop: compact ? Math.max(insets.top, 12) : 0, paddingBottom: compact ? Math.max(insets.bottom, 14) : 0 },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>Notifications</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>{unread ? `${unread} unread for this household` : "You’re all caught up"}</Text>
            </View>
            {unread ? (
              <Pressable accessibilityRole="button" onPress={onMarkAllRead} style={styles.markAllButton}>
                <Text style={[styles.markAllText, { color: c.primary }]}>Mark all read</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={22} color={c.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {notifications.map(notification => {
              const color = toneColor(notification.tone);
              const isUnread = !read.has(notification.id);
              return (
                <View key={notification.id} style={[styles.item, { borderColor: c.border, backgroundColor: isUnread ? c.primary + "0C" : c.card }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${isUnread ? "Unread. " : ""}${notification.title}. ${notification.body}`}
                    onPress={() => onOpen(notification)}
                    style={({ pressed }) => [styles.itemMain, { opacity: pressed ? 0.72 : 1 }]}
                  >
                    <View style={[styles.itemIcon, { backgroundColor: color + "17", borderColor: color + "32" }]}>
                      <Feather name={ICONS[notification.type]} size={18} color={color} />
                    </View>
                    <View style={styles.itemCopy}>
                      <View style={styles.itemTitleRow}>
                        <Text style={[styles.itemTitle, { color: c.foreground }]}>{notification.title}</Text>
                        {isUnread ? <View accessibilityLabel="Unread" style={[styles.unreadDot, { backgroundColor: c.primary }]} /> : null}
                      </View>
                      <Text style={[styles.itemBody, { color: c.mutedForeground }]}>{notification.body}</Text>
                      <Text style={[styles.itemTime, { color }]}>{timestampLabel(notification.timestamp)}</Text>
                    </View>
                    <Feather name="chevron-right" size={17} color={c.mutedForeground} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${notification.title}`} onPress={() => onDismiss(notification.id)} style={styles.dismissButton}>
                    <Feather name="x" size={16} color={c.mutedForeground} />
                  </Pressable>
                </View>
              );
            })}
            {notifications.length === 0 ? (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: c.success + "16" }]}><Feather name="check-circle" size={26} color={c.success} /></View>
                <Text style={[styles.emptyTitle, { color: c.foreground }]}>You&apos;re all caught up</Text>
                <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>New bill reminders, forecast warnings, milestones, and Review Center items will appear here.</Text>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", alignItems: "flex-end", paddingTop: 72, paddingRight: 28, paddingBottom: 28 },
  backdropCompact: { padding: 0, justifyContent: "flex-end", alignItems: "center" },
  dialog: { width: 430, maxWidth: "94%", maxHeight: "86%", borderRadius: 22, borderWidth: 1, overflow: "hidden", shadowColor: "#7c3aed", shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 16 } },
  dialogCompact: { width: "100%", maxWidth: "100%", height: "100%", maxHeight: "100%", borderRadius: 0 },
  header: { minHeight: 76, borderBottomWidth: 1, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 21, letterSpacing: -0.3 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 3 },
  markAllButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: 7 },
  markAllText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  list: { padding: 12, gap: 9 },
  item: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  itemMain: { minHeight: 96, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11 },
  itemIcon: { width: 40, height: 40, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, minWidth: 0 },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  itemTitle: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 19 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  itemBody: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18, marginTop: 3 },
  itemTime: { fontFamily: "Inter_700Bold", fontSize: 10, marginTop: 7 },
  dismissButton: { position: "absolute", right: 3, bottom: 3, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 26, paddingVertical: 64 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 15 },
  emptyTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 18 },
  emptyBody: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 7 },
});

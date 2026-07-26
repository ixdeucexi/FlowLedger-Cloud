import { Feather } from "@expo/vector-icons";
import React, { memo, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { subscribeConfirmAction, type ConfirmActionOptions } from "@/lib/confirmAction";

function ConfirmActionModalView() {
  const c = useColors();
  const [request, setRequest] = useState<ConfirmActionOptions | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeConfirmAction(options => {
    setError("");
    setRunning(false);
    setRequest(options);
  }), []);

  const confirmText = request?.confirmText ?? "Confirm";
  const destructive = useMemo(
    () => Boolean(request?.destructive || /delete|remove|leave|stop|archive|discard/i.test(confirmText)),
    [confirmText, request?.destructive],
  );
  const actionColor = destructive ? c.destructive : c.primary;

  const close = () => {
    if (running) return;
    setError("");
    setRequest(null);
  };

  const confirm = async () => {
    if (!request || running) return;
    setRunning(true);
    setError("");
    try {
      await request.onConfirm();
      setRequest(null);
    } catch {
      setError("That could not be completed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal visible={Boolean(request)} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cancel ${confirmText.toLowerCase()}`}
        style={styles.overlay}
        onPress={close}
      >
        <Pressable
          accessibilityRole="alert"
          style={[styles.dialog, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => undefined}
        >
          <View style={[styles.icon, { backgroundColor: actionColor + "18" }]}>
            <Feather name={destructive ? "trash-2" : "help-circle"} size={20} color={actionColor} />
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>{request?.title}</Text>
          <Text style={[styles.body, { color: c.mutedForeground }]}>{request?.message}</Text>
          {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={running}
              onPress={close}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: c.muted, opacity: running ? 0.5 : pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.actionText, { color: c.mutedForeground }]}>{request?.cancelText ?? "Cancel"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${confirmText} now`}
              disabled={running}
              onPress={() => void confirm()}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: actionColor, opacity: running ? 0.65 : pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.actionText, { color: destructive ? "#fff" : c.primaryForeground }]}>
                {running ? `${confirmText}…` : confirmText}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const ConfirmActionModal = memo(ConfirmActionModalView);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: "Inter_800ExtraBold",
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    fontFamily: "Inter_500Medium",
  },
  error: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    fontFamily: "Inter_700Bold",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  action: {
    minHeight: 46,
    minWidth: 96,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  actionText: {
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
  },
});

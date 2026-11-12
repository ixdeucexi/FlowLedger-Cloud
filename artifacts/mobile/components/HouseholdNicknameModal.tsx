import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyTextInput as TextInput,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import { useAuth } from "@/context/AuthContext";
import { useBudget } from "@/context/BudgetContext";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import {
  DESKTOP_MODAL_COMPACT,
  DESKTOP_MODAL_OVERLAY,
} from "@/lib/desktopModal";
import { normalizeHouseholdName } from "@/lib/householdNames";

export interface HouseholdNicknameTarget {
  userId: string;
  householdId: string;
}
export function HouseholdNicknameModal({
  target,
  onClose,
}: {
  target: HouseholdNicknameTarget | null;
  onClose: () => void;
}) {
  const c = useColors(),
    desktop = useDesktopExperience(),
    insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    activeHousehold,
    householdRole,
    demoMode,
    startupCoreReady,
    saveActiveHouseholdNickname,
    refreshHouseholdNicknames,
  } = useBudget();
  const visible = Boolean(
    target &&
    target.userId === user?.id &&
    target.householdId === activeHousehold?.householdId &&
    householdRole &&
    !demoMode,
  );
  const editorKey =
    visible && target ? `${target.userId}:${target.householdId}` : null;
  const current = useRef({
    editorKey,
    ready: Boolean(activeHousehold?.nicknameReady && startupCoreReady),
  });
  current.current = {
    editorKey,
    ready: Boolean(activeHousehold?.nicknameReady && startupCoreReady),
  };
  const attempt = useRef(0),
    pending = useRef(false);
  const [name, setName] = useState(""),
    [expected, setExpected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false),
    [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => {
    attempt.current += 1;
    pending.current = false;
    setName(activeHousehold?.nickname ?? "");
    setExpected(activeHousehold?.nickname ?? null);
    setSaving(false);
    setReloading(false);
    setError(null);
  }, [target, reloadVersion]);
  useEffect(() => {
    if (target && !visible) onClose();
  }, [target, visible, onClose]);
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );
  useBackDismiss(visible && !saving && !reloading, onClose);
  const reload = async () => {
    if (!editorKey || pending.current) return;
    const started = ++attempt.current;
    pending.current = true;
    setReloading(true);
    setError(null);
    try {
      await refreshHouseholdNicknames();
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      )
        setReloadVersion((value) => value + 1);
    } catch (caught) {
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "Your nicknames could not be loaded. Try again.",
        );
    } finally {
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      ) {
        pending.current = false;
        setReloading(false);
      }
    }
  };
  const save = async (remove = false) => {
    if (!editorKey || pending.current || !current.current.ready) return;
    let canonical: string | null = null;
    if (!remove) {
      try {
        canonical = normalizeHouseholdName(name);
      } catch (caught) {
        setError(
          (caught as Error).message.replace("household name", "nickname"),
        );
        return;
      }
    }
    if (canonical === expected) return;
    const started = ++attempt.current;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveActiveHouseholdNickname(canonical, expected);
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      )
        onClose();
    } catch (caught) {
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      )
        setError(
          caught instanceof Error
            ? caught.message
            : "Your nickname could not be saved. Try again.",
        );
    } finally {
      if (
        started === attempt.current &&
        current.current.editorKey === editorKey
      ) {
        pending.current = false;
        setSaving(false);
      }
    }
  };
  let unchanged = false;
  try {
    unchanged = normalizeHouseholdName(name) === expected;
  } catch {
    /* Show invalid input when Save is selected. */
  }
  const ready = Boolean(activeHousehold?.nicknameReady && startupCoreReady),
    busy = saving || reloading;
  return (
    <Modal
      visible={visible}
      transparent
      animationType={desktop ? "fade" : "slide"}
      onRequestClose={busy ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}
      >
        <Pressable
          accessibilityLabel="Close household nickname editor"
          disabled={busy}
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: c.background,
              borderColor: c.border,
              paddingBottom: Math.max(24, insets.bottom + 16),
            },
            desktop && DESKTOP_MODAL_COMPACT,
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 10 }}
            style={{ flexGrow: 0 }}
          >
            <View style={styles.header}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: c.foreground }]}>
                  Household nickname
                </Text>
                <Text style={[styles.help, { color: c.primary }]}>
                  Only for you
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close household nickname editor"
                disabled={busy}
                onPress={onClose}
                style={styles.close}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              Give this household a name that helps you tell it apart. Other
              members keep seeing the shared name.
            </Text>
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Shared household name
            </Text>
            <Text style={[styles.sharedName, { color: c.foreground }]}>
              {activeHousehold?.name}
            </Text>
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Your nickname
            </Text>
            <TextInput
              accessibilityLabel="Household nickname"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setError(null);
              }}
              placeholder={activeHousehold?.name}
              placeholderTextColor={c.mutedForeground}
              editable={!busy && ready}
              autoCapitalize="words"
              selectTextOnFocus
              onSubmitEditing={() => void save()}
              returnKeyType="done"
              style={[
                styles.input,
                {
                  color: c.foreground,
                  backgroundColor: c.card,
                  borderColor: error ? c.destructive : c.border,
                },
              ]}
            />
            {!ready ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.destructive }]}
              >
                {activeHousehold?.nicknameError ??
                  "Load your nicknames before making changes."}
              </Text>
            ) : null}
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.destructive }]}
              >
                {error}
              </Text>
            ) : null}
            {!ready || error ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reload household nicknames"
                disabled={busy}
                onPress={() => void reload()}
                style={[styles.reload, { borderColor: c.border }]}
              >
                <Text style={[styles.actionText, { color: c.primary }]}>
                  {reloading ? "Loading…" : "Reload nicknames"}
                </Text>
              </Pressable>
            ) : null}
            {expected !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove household nickname"
                disabled={busy || !ready}
                onPress={() => void save(true)}
                style={styles.remove}
              >
                <Text
                  style={[
                    styles.actionText,
                    { color: c.primary, opacity: !ready || busy ? 0.5 : 1 },
                  ]}
                >
                  Remove nickname
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={[styles.secondary, { borderColor: c.border }]}
            >
              <Text style={[styles.actionText, { color: c.foreground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                saving ? "Saving household nickname" : "Save household nickname"
              }
              disabled={busy || !ready || unchanged}
              onPress={() => void save()}
              style={[
                styles.primary,
                {
                  backgroundColor: c.primary,
                  opacity: busy || !ready || unchanged ? 0.55 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={c.primaryForeground} />
              ) : (
                <Text
                  style={[styles.actionText, { color: c.primaryForeground }]}
                >
                  Save nickname
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.65)",
  },
  sheet: {
    padding: 22,
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22 },
  help: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  sharedName: { fontSize: 14, lineHeight: 20 },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  secondary: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  primary: {
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  reload: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  remove: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});

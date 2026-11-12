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
import { canManageHouseholdMembers } from "@/lib/householdPermissions";

export interface HouseholdNameEditorTarget {
  userId: string;
  householdId: string;
  name: string;
}

export function HouseholdNameModal({
  target,
  onClose,
}: {
  target: HouseholdNameEditorTarget | null;
  onClose: () => void;
}) {
  const c = useColors();
  const desktop = useDesktopExperience();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    activeHousehold,
    householdRole,
    demoMode,
    startupCoreReady,
    renameActiveHousehold,
  } = useBudget();
  const permitted = !demoMode && canManageHouseholdMembers(householdRole);
  const visible = Boolean(
    target &&
    target.userId === user?.id &&
    target.householdId === activeHousehold?.householdId &&
    permitted,
  );
  const editorKey =
    visible && target ? `${target.userId}:${target.householdId}` : null;
  const access = useRef({ editorKey, permitted, ready: startupCoreReady });
  access.current = { editorKey, permitted, ready: startupCoreReady };
  const requestRef = useRef(0);
  const savingRef = useRef(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestRef.current += 1;
    savingRef.current = false;
    setName(target?.name ?? "");
    setError(null);
    setSaving(false);
  }, [target]);
  useEffect(() => {
    if (target && !visible) onClose();
  }, [target, visible, onClose]);
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );
  useBackDismiss(visible && !saving, onClose);
  let unchanged = false;
  try {
    unchanged = normalizeHouseholdName(name) === target?.name;
  } catch {
    /* Show validation when saving. */
  }
  const save = async () => {
    if (!target || !editorKey || savingRef.current) return;
    if (
      access.current.editorKey !== editorKey ||
      !access.current.permitted ||
      !access.current.ready
    ) {
      setError("Your household or access changed. Reopen the name editor.");
      return;
    }
    let normalized: string;
    try {
      normalized = normalizeHouseholdName(name);
    } catch (caught) {
      setError((caught as Error).message);
      return;
    }
    if (normalized === target.name) return;
    const request = ++requestRef.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const isCurrent = () =>
      request === requestRef.current && access.current.editorKey === editorKey;
    try {
      await renameActiveHousehold(normalized, target.name);
      if (isCurrent()) onClose();
    } catch (caught) {
      if (isCurrent())
        setError(
          caught instanceof Error
            ? caught.message
            : "The household name could not be saved. Try again.",
        );
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType={desktop ? "fade" : "slide"}
      onRequestClose={saving ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.overlay, desktop && DESKTOP_MODAL_OVERLAY]}
      >
        <Pressable
          accessibilityLabel="Close household name editor"
          disabled={saving}
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
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            style={{ flexGrow: 0 }}
          >
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: c.foreground }]}>
                  Rename household
                </Text>
                <Text style={[styles.help, { color: c.mutedForeground }]}>
                  Choose a name everyone will recognize.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close household name editor"
                disabled={saving}
                onPress={onClose}
                style={styles.close}
              >
                <Feather name="x" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Household name
            </Text>
            <TextInput
              accessibilityLabel="Household name"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setError(null);
              }}
              autoCapitalize="words"
              selectTextOnFocus
              editable={!saving && permitted}
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
            <Text style={[styles.help, { color: c.mutedForeground }]}>
              Up to 80 characters. Members will see the new name.
            </Text>
            {error ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: c.destructive }]}
              >
                {error}
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
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
                saving ? "Saving household name" : "Save household name"
              }
              disabled={saving || unchanged || !permitted || !startupCoreReady}
              onPress={() => void save()}
              style={[
                styles.primary,
                {
                  backgroundColor: c.primary,
                  opacity: saving || unchanged || !startupCoreReady ? 0.55 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={c.primaryForeground} />
              ) : (
                <Text
                  style={[styles.actionText, { color: c.primaryForeground }]}
                >
                  Save name
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
  content: { gap: 10 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22 },
  help: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 8 },
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
  error: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
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
});

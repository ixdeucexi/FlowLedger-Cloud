import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Switch } from "react-native";
import { useBucketAppearance } from "@/hooks/useBucketAppearance";
import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import {
  BUCKET_COVERS,
  BUCKET_ICONS,
  DEFAULT_BUCKET_LOOK,
  type BucketLook,
} from "@/lib/bucketAppearance";
import {
  BucketCover,
  BucketThumbnail,
  BucketCoverSwatch,
} from "@/components/BucketVisual";

export function BucketAppearanceModal({
  goalId,
  name,
  onClose,
}: {
  goalId: string;
  name: string;
  onClose: () => void;
}) {
  const c = useColors(),
    desktop = useDesktopExperience(),
    appearance = useBucketAppearance(goalId);
  const { hidden } = useMoneyPrivacy();
  const [error, setError] = useState<string | null>(null),
    [working, setWorking] = useState(false);
  const busy = working || appearance.saving,
    blocked = busy || !appearance.ready || Boolean(appearance.loadError);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  useBackDismiss(true, close);
  const run = async (operation: () => Promise<unknown>) => {
    if (blocked) return;
    setWorking(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      if (mounted.current && appearance.current())
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t save this look. Please try again.",
        );
    } finally {
      if (mounted.current && appearance.current()) setWorking(false);
    }
  };
  const save = (patch: Partial<BucketLook>) =>
    void run(() => appearance.update(patch));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View
        style={[
          styles.overlay,
          desktop && { justifyContent: "center", padding: 24 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close bucket personalization"
          onPress={close}
          style={StyleSheet.absoluteFillObject}
          disabled={busy}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: c.background, borderColor: c.border },
            desktop && { maxWidth: 620, alignSelf: "center", borderRadius: 24 },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: c.foreground }]}
              >
                Personalize {name}
              </Text>
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                On this device · Your bucket’s money stays the same.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close personalization"
              onPress={close}
              disabled={busy}
              style={styles.close}
            >
              <Feather name="x" color={c.mutedForeground} size={22} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                styles.preview,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <BucketCover goalId={goalId} name={name} force />
              <View style={styles.previewName}>
                <BucketThumbnail goalId={goalId} name={name} size={36} />
                <Text style={[styles.previewLabel, { color: c.foreground }]}>
                  {name}
                </Text>
              </View>
            </View>
            {!appearance.ready && !appearance.loadError ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: c.mutedForeground }}
              >
                Loading your saved look…
              </Text>
            ) : null}
            {appearance.loadError ? (
              <View style={styles.message}>
                <Text accessibilityRole="alert" style={{ color: c.warning }}>
                  {appearance.loadError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading bucket appearance"
                  onPress={() => void appearance.retryLoad()}
                  style={styles.retry}
                >
                  <Text style={{ color: c.primary }}>Retry loading</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={[styles.label, { color: c.foreground }]}>
              Choose an icon
            </Text>
            <View style={styles.icons}>
              {BUCKET_ICONS.map((icon) => (
                <Pressable
                  key={icon}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${icon} bucket icon`}
                  accessibilityState={{
                    selected: appearance.look.icon === icon,
                    disabled: blocked,
                  }}
                  aria-pressed={appearance.look.icon === icon}
                  disabled={blocked}
                  onPress={() => save({ icon })}
                  style={[
                    styles.iconChoice,
                    {
                      borderColor:
                        appearance.look.icon === icon ? c.primary : c.border,
                      backgroundColor:
                        appearance.look.icon === icon
                          ? c.primary + "20"
                          : c.card,
                    },
                  ]}
                >
                  <Feather
                    name={icon}
                    size={22}
                    color={
                      appearance.look.icon === icon ? c.primary : c.foreground
                    }
                  />
                  {appearance.look.icon === icon ? (
                    <View style={styles.tinyCheck}>
                      <Feather name="check" size={10} color={c.primary} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
            <Text style={[styles.label, { color: c.foreground }]}>
              Choose a cover
            </Text>
            <View style={styles.covers}>
              {BUCKET_COVERS.map((cover) => (
                <Pressable
                  key={cover}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${cover} bucket cover`}
                  accessibilityState={{
                    selected:
                      appearance.look.cover === cover &&
                      !appearance.look.photoId,
                    disabled: blocked,
                  }}
                  aria-pressed={
                    appearance.look.cover === cover && !appearance.look.photoId
                  }
                  disabled={blocked}
                  onPress={() => save({ cover, photoId: undefined })}
                  style={[
                    styles.coverChoice,
                    {
                      backgroundColor: c.card,
                      borderColor:
                        appearance.look.cover === cover &&
                        !appearance.look.photoId
                          ? c.primary
                          : c.border,
                    },
                  ]}
                >
                  <BucketCoverSwatch cover={cover} />
                  <Text
                    style={{
                      color:
                        appearance.look.cover === cover &&
                        !appearance.look.photoId
                          ? c.primary
                          : c.foreground,
                      textTransform: "capitalize",
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    {cover === "none" ? "No cover" : cover}
                  </Text>
                  {appearance.look.cover === cover &&
                  !appearance.look.photoId ? (
                    <Feather name="check" size={13} color={c.primary} />
                  ) : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.photoRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose a bucket photo"
                disabled={blocked}
                onPress={() => void run(appearance.pickPhoto)}
                style={[
                  styles.button,
                  { backgroundColor: c.primary, opacity: blocked ? 0.5 : 1 },
                ]}
              >
                <Feather name="image" size={17} color={c.primaryForeground} />
                <Text
                  style={[styles.buttonText, { color: c.primaryForeground }]}
                >
                  {appearance.look.photoId ? "Replace photo" : "Choose photo"}
                </Text>
              </Pressable>
              {appearance.look.photoId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove bucket photo"
                  disabled={blocked}
                  onPress={() => save({ photoId: undefined })}
                  style={[
                    styles.button,
                    { borderColor: c.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: c.foreground }]}>
                    Remove photo
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {hidden ? (
              <Text style={[styles.copy, { color: c.mutedForeground }]}>
                Photos are hidden while Privacy Mode is on.
              </Text>
            ) : null}
            <Text style={[styles.copy, { color: c.mutedForeground }]}>
              JPG, PNG or WebP · up to 12 MB. Photos stay on this device and
              aren’t uploaded.
            </Text>
            <View
              style={[
                styles.moments,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: c.foreground }]}>
                  Milestone moments
                </Text>
                <Text style={[styles.copy, { color: c.mutedForeground }]}>
                  A small celebration when this bucket closes or a savings goal
                  reaches its target.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Celebrate bucket and goal milestones"
                value={appearance.look.celebrateCompletion}
                disabled={blocked}
                onValueChange={(celebrateCompletion) =>
                  save({ celebrateCompletion })
                }
                trackColor={{ true: c.primary }}
              />
            </View>
            {error || appearance.saveError ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: c.destructive }]}
              >
                {error || appearance.saveError} Tap your choice again to retry.
              </Text>
            ) : null}
            {busy ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: c.mutedForeground }}
              >
                Saving your look…
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset this bucket appearance"
              disabled={blocked}
              onPress={() =>
                save({ ...DEFAULT_BUCKET_LOOK, photoId: undefined })
              }
              style={[styles.button, { borderColor: c.border, borderWidth: 1 }]}
            >
              <Feather name="rotate-ccw" size={15} color={c.foreground} />
              <Text style={[styles.buttonText, { color: c.foreground }]}>
                Reset this bucket’s look
              </Text>
            </Pressable>
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <Text style={[styles.copy, { color: c.mutedForeground }]}>
              Changes save as you choose.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done personalizing bucket"
              disabled={busy}
              onPress={close}
              style={[styles.button, { backgroundColor: c.primary }]}
            >
              <Text style={[styles.buttonText, { color: c.primaryForeground }]}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,.72)",
  },
  sheet: {
    maxHeight: "93%",
    width: "100%",
    borderWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  header: {
    padding: 18,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  title: { fontSize: 21, fontFamily: "Inter_800ExtraBold", lineHeight: 28 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 18, gap: 14, paddingBottom: 24 },
  copy: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  label: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_700Bold" },
  preview: { overflow: "hidden", borderWidth: 1, borderRadius: 18 },
  previewName: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  previewLabel: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 16 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  iconChoice: {
    width: 48,
    height: 48,
    borderWidth: 2,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tinyCheck: { position: "absolute", right: 2, top: 2 },
  covers: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  coverChoice: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  moments: {
    borderWidth: 1,
    padding: 13,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  error: { fontSize: 13, lineHeight: 19 },
  message: { gap: 8 },
  retry: { minHeight: 44, justifyContent: "center" },
  footer: {
    borderTopWidth: 1,
    padding: 16,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
});

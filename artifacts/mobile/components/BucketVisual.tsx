import {
  PrivacyPressable as Pressable,
  PrivacyText as Text,
  PrivacyView as View,
} from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, StyleSheet } from "react-native";
import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import {
  useBucketAppearance,
  useBucketPhoto,
} from "@/hooks/useBucketAppearance";
import { useColors } from "@/hooks/useColors";
import type { BucketCoverStyle } from "@/lib/bucketAppearance";

const COVER_COLORS: Record<BucketCoverStyle, readonly [string, string]> = {
  none: ["#1e293b", "#0f172a"],
  violet: ["#6d28d9", "#312e81"],
  ocean: ["#0369a1", "#115e59"],
  forest: ["#15803d", "#064e3b"],
  sunset: ["#be185d", "#9a3412"],
  sand: ["#b45309", "#78350f"],
};
export function BucketCoverSwatch({ cover }: { cover: BucketCoverStyle }) {
  return (
    <LinearGradient
      colors={COVER_COLORS[cover]}
      style={{ width: 22, height: 22, borderRadius: 6 }}
    />
  );
}
export function BucketThumbnail({
  goalId,
  name,
  size = 36,
  hidePhoto = false,
}: {
  goalId: string;
  name: string;
  size?: number;
  hidePhoto?: boolean;
}) {
  const { hidden } = useMoneyPrivacy();
  const c = useColors(),
    appearance = useBucketAppearance(goalId),
    photo = useBucketPhoto(appearance, hidePhoto || hidden);
  return (
    <View
      accessibilityLabel={`${name} ${appearance.look.icon} icon${appearance.look.photoId ? ", personal photo" : ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        overflow: "hidden",
        backgroundColor: c.primary + "18",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {photo.uri ? (
        <Image
          source={{ uri: photo.uri }}
          accessibilityLabel="Personal bucket photo"
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          onError={photo.fail}
        />
      ) : appearance.look.cover !== "none" ? (
        <>
          <LinearGradient
            colors={COVER_COLORS[appearance.look.cover]}
            style={StyleSheet.absoluteFillObject}
          />
          <Feather
            name={appearance.look.icon}
            size={Math.round(size * 0.52)}
            color="#ffffff"
          />
        </>
      ) : (
        <Feather
          name={appearance.look.icon}
          size={Math.round(size * 0.52)}
          color={c.primary}
        />
      )}
    </View>
  );
}
export function BucketCover({
  goalId,
  name,
  force = false,
  hidePhoto = false,
}: {
  goalId: string;
  name: string;
  force?: boolean;
  hidePhoto?: boolean;
}) {
  const { hidden } = useMoneyPrivacy();
  const c = useColors(),
    appearance = useBucketAppearance(goalId),
    photo = useBucketPhoto(appearance, hidePhoto || hidden);
  if (!force && appearance.look.cover === "none" && !appearance.look.photoId)
    return null;
  if (force && appearance.look.cover === "none" && !appearance.look.photoId)
    return (
      <View
        style={[styles.cover, { backgroundColor: c.card, height: 110, gap: 8 }]}
      >
        <Feather name={appearance.look.icon} color={c.primary} size={32} />
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>No cover</Text>
      </View>
    );
  return (
    <View accessibilityLabel={`${name} bucket cover`} style={styles.cover}>
      <LinearGradient
        colors={
          appearance.look.cover === "none"
            ? [c.primary, c.background]
            : COVER_COLORS[appearance.look.cover]
        }
        style={StyleSheet.absoluteFillObject}
      />
      {photo.uri ? (
        <Image
          source={{ uri: photo.uri }}
          accessibilityLabel="Personal bucket cover photo"
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          onError={photo.fail}
        />
      ) : (
        <View style={styles.decor}>
          <Feather
            name={appearance.look.icon}
            size={64}
            color="rgba(255,255,255,.85)"
          />
        </View>
      )}
      {photo.error ? (
        <View style={[styles.photoError, { backgroundColor: c.card }]}>
          <Text style={{ color: c.foreground, fontSize: 12 }}>
            {photo.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry ${name} photo`}
            onPress={photo.retry}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: c.primary }}>Retry photo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  cover: {
    height: 150,
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  decor: { opacity: 0.65, transform: [{ rotate: "-8deg" }] },
  photoError: { padding: 10, borderRadius: 10, maxWidth: "92%" },
});

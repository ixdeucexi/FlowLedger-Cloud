import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useFloLauncherPreference } from "@/hooks/useFloLauncherPreference";

export function FloLauncherSetting() {
  const c = useColors();
  const preference = useFloLauncherPreference();
  return (
    <View
      style={{ padding: 16, borderRadius: 16, backgroundColor: c.card, gap: 8 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 15,
            }}
          >
            Flo shortcut
          </Text>
          <Text
            style={{ color: c.mutedForeground, fontSize: 12, marginTop: 4 }}
          >
            Show the floating Flo button. Hold it to hide. Saved for this
            household on this device.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Show Flo shortcut"
          value={preference.enabled}
          disabled={!preference.ready || preference.saving}
          onValueChange={(value) => {
            void preference.setEnabled(value);
          }}
          trackColor={{ true: c.primary }}
        />
      </View>
      {preference.saving ? (
        <Text style={{ color: c.mutedForeground }}>Saving…</Text>
      ) : null}
      {preference.error ? (
        <Text accessibilityRole="alert" style={{ color: c.foreground }}>
          {preference.error}
        </Text>
      ) : null}
      {!preference.ready && preference.error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void preference.retry();
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: c.primary }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

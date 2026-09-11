import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useTodayWithFloPreference } from "@/hooks/useTodayWithFloPreference";
export function TodayWithFloSetting() {
  const c = useColors();
  const preference = useTodayWithFloPreference();
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
            Today with Flo
          </Text>
          <Text
            style={{ color: c.mutedForeground, fontSize: 12, marginTop: 4 }}
          >
            One useful takeaway when you open the app each day. On this device,
            for this household. Separate from the Flo shortcut.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Show Today with Flo"
          value={preference.enabled}
          disabled={!preference.ready || preference.saving}
          onValueChange={(value) => {
            void preference.store.setEnabled(value);
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
            void preference.store.hydrate();
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: c.primary }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

import React from "react";
import { Linking, Pressable, Text, View } from "react-native";

export function PlaidLinkButton({ colors }: { colors: { card: string; foreground: string; mutedForeground: string; primary?: string; primaryForeground?: string }; onConnected?: () => void }) {
  const primary = colors.primary ?? "#9b5cff";
  const primaryForeground = colors.primaryForeground ?? "#ffffff";
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16 }}>
      <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>Manage bank connections securely on the website</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6, lineHeight: 20 }}>Connected balances still appear in this app. Use the secure web flow to connect, reconnect, rename, or disconnect an institution.</Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open bank connection settings on the FlowLedger website"
        onPress={() => void Linking.openURL("https://flowledger-algo.com/more?section=plaid")}
        style={({ pressed }) => ({ minHeight: 48, marginTop: 14, borderRadius: 14, backgroundColor: primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, opacity: pressed ? 0.78 : 1 })}
      >
        <Text style={{ color: primaryForeground, fontWeight: "800", fontSize: 14 }}>Open bank connection settings</Text>
      </Pressable>
    </View>
  );
}

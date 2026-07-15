import React from "react";
import { Text, View } from "react-native";

export function PlaidLinkButton({ colors }: { colors: { card: string; foreground: string; mutedForeground: string }; onConnected?: () => void }) {
  return <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16 }}><Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 16 }}>Bank linking is available in the web app.</Text><Text style={{ color: colors.mutedForeground, marginTop: 6 }}>Open FlowLedger in a browser to connect a bank through Plaid.</Text></View>;
}

import React from "react";
import { Image, StyleSheet, View } from "react-native";

type Props = {
  size?: number;
  ring?: boolean;
};

export function FloLogo({ size = 44, ring = true }: Props) {
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring ? 1 : 0,
        },
      ]}
    >
      <Image
        source={require("../assets/brand/flo-logo.jpg")}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderColor: "rgba(56,189,248,0.55)",
    backgroundColor: "#020617",
    shadowColor: "#2563eb",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});

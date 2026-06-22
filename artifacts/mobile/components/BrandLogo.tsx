import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

const WORDMARK_ASPECT_RATIO = 914 / 230;

type BrandLogoProps = {
  width?: number;
  style?: StyleProp<ImageStyle>;
};

export function BrandLogo({ width = 180, style }: BrandLogoProps) {
  return (
    <Image
      source={require("@/assets/images/logo_cropped.png")}
      style={[{ width, height: width / WORDMARK_ASPECT_RATIO }, style]}
      resizeMode="contain"
      accessibilityLabel="FlowLedger"
    />
  );
}

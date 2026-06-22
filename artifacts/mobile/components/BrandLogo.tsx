import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

const WORDMARK_ASPECT_RATIO = 457 / 115;

type BrandLogoProps = {
  width?: number;
  style?: StyleProp<ImageStyle>;
};

export const BrandLogo = React.memo(function BrandLogo({ width = 180, style }: BrandLogoProps) {
  return (
    <Image
      source={require("@/assets/images/logo_wordmark_optimized.png")}
      style={[{ width, height: width / WORDMARK_ASPECT_RATIO }, style]}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityLabel="FlowLedger"
    />
  );
});

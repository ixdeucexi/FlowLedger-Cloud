import { PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { useColors } from "@/hooks/useColors";
import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

/** Full calendar text. Large values scroll locally instead of losing digits or shrinking. */
export function CalendarAmountLabel({ label, accessibilityLabel, textStyle, style, inline = false }: {
  label: string;
  accessibilityLabel?: string;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  inline?: boolean;
}) {
  const c = useColors();
  const { hidden } = useMoneyPrivacy();
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const overflowing = !hidden && viewportWidth > 0 && contentWidth > viewportWidth + .5;

  // RN Web disables touch gestures on a disabled scroller, even when its text fits.
  return <View accessibilityLabel={accessibilityLabel} style={[styles.container, inline && styles.inline, style]}>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={Platform.OS === "web" || overflowing}
      tabIndex={overflowing ? 0 : -1}
      focusable={overflowing}
      accessibilityLabel={overflowing ? "Scroll full calendar amount" : "Calendar amount"}
      accessibilityHint={overflowing ? "Swipe horizontally or use the left and right arrow keys to read the full amount." : undefined}
      onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
      onContentSizeChange={width => setContentWidth(width)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerDown={event => { if (overflowing) event.stopPropagation(); }}
      onTouchStart={event => { if (overflowing) event.stopPropagation(); }}
      style={[styles.scroll, focused && overflowing && { borderBottomWidth: 1, borderBottomColor: c.primary }]}
      contentContainerStyle={styles.content}
    >
      <Text sensitive style={[styles.text, textStyle, styles.fullText]}>{label}</Text>
    </ScrollView>
    {overflowing ? <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.hint, { color: c.mutedForeground }]}>↔</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: "100%", minWidth: 0, maxWidth: "100%", flexShrink: 1 },
  inline: { width: "48%", alignSelf: "center" },
  scroll: { flexGrow: 0, minWidth: 0, maxWidth: "100%" },
  content: { minWidth: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center" },
  text: { fontSize: 10, fontFamily: "Inter_700Bold" },
  fullText: { flexShrink: 0 },
  hint: { fontSize: 10, lineHeight: 11, textAlign: "center" },
});

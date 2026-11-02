import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import Feather from "@expo/vector-icons/Feather";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StyleSheet, TextInput, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useOverlayActivity } from "@/hooks/useOverlayActivity";
import { hexToHsv, hsvToHex, normalizeHexColor, type HexColor, type HsvColor } from "@/lib/customColors";
import { calendarHighlightText } from "@/lib/calendarAppearance";

const RAINBOW = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] as const;
const webGestureStyle = Platform.OS === "web" ? { touchAction: "none" } as ViewStyle : undefined;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A local draft: only the parent's explicit onApply callback persists a color. */
export function CustomColorPicker({ title, initialColor, onApply, onCancel }: { title: string; initialColor: string; onApply: (color: HexColor) => void; onCancel: () => void }) {
  const c = useColors();
  const initial = normalizeHexColor(initialColor) ?? normalizeHexColor(c.primary) ?? "#9f5cff";
  const [hex, setHex] = useState<string>(initial);
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(initial)!);
  const hsvRef = useRef(hsv);hsvRef.current = hsv;
  const squareSize = useRef({ width: 1, height: 1 });
  const hueWidth = useRef(1);
  const headingRef = useRef<View>(null);
  const normalized = normalizeHexColor(hex);
  const preview = normalized ?? hsvToHex(hsv) ?? initial;
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })!;
  useOverlayActivity(true);
  const changeHsv = useCallback((next: HsvColor) => {
    const color = hsvToHex(next);
    if (!color) return;
    hsvRef.current = next;setHsv(next);setHex(color);
  }, []);
  const squarePan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => changeHsv({ ...hsvRef.current, s: clamp(event.nativeEvent.locationX / squareSize.current.width), v: 1 - clamp(event.nativeEvent.locationY / squareSize.current.height) }),
    onPanResponderMove: event => changeHsv({ ...hsvRef.current, s: clamp(event.nativeEvent.locationX / squareSize.current.width), v: 1 - clamp(event.nativeEvent.locationY / squareSize.current.height) }),
  }), [changeHsv]);
  const huePan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => changeHsv({ ...hsvRef.current, h: clamp(event.nativeEvent.locationX / hueWidth.current) * 360 }),
    onPanResponderMove: event => changeHsv({ ...hsvRef.current, h: clamp(event.nativeEvent.locationX / hueWidth.current) * 360 }),
  }), [changeHsv]);
  const stepHue = (amount: number) => changeHsv({ ...hsvRef.current, h: (hsvRef.current.h + amount + 360) % 360 });

  return <Modal visible transparent animationType="fade" onRequestClose={onCancel} onShow={() => {
    if (Platform.OS === "web") (headingRef.current as unknown as { focus?: (options: { preventScroll: boolean }) => void } | null)?.focus?.({ preventScroll: true });
  }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
      <Pressable accessibilityLabel="Cancel custom color backdrop" onPress={onCancel} style={StyleSheet.absoluteFillObject} />
      <View accessibilityViewIsModal accessibilityLabel="Custom color editor" style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View ref={headingRef} focusable tabIndex={-1} accessibilityRole="header" accessibilityLabel={title} style={styles.flex}><Text style={[styles.title, { color: c.foreground }]}>{title}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel custom color editor" onPress={onCancel} style={[styles.close, { borderColor: c.border }]}><Feather name="x" size={20} color={c.foreground} /></Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.copy, { color: c.mutedForeground }]}>Drag to choose a color, or enter an opaque hex value. Nothing is saved until you choose Apply.</Text>
          <View accessibilityLabel="Color saturation and brightness" accessibilityRole="adjustable" accessibilityHint="Drag the square, or enter the exact color in the hex field below." accessibilityValue={{ min: 0, max: 100, now: Math.round(hsv.v * 100), text: `${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness` }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === "increment" || event.nativeEvent.actionName === "decrement") changeHsv({ ...hsvRef.current, v: clamp(hsvRef.current.v + (event.nativeEvent.actionName === "increment" ? .05 : -.05)) }); }} onLayout={event => { squareSize.current = event.nativeEvent.layout; }} {...squarePan.panHandlers} style={[styles.square, webGestureStyle, { backgroundColor: hueColor }]}>
            <LinearGradient pointerEvents="none" colors={["#ffffff", "rgba(255,255,255,0)"]} start={{ x: 0, y: .5 }} end={{ x: 1, y: .5 }} style={StyleSheet.absoluteFillObject} />
            <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0)", "#000000"]} style={StyleSheet.absoluteFillObject} />
            <View pointerEvents="none" style={[styles.marker, { left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }]} />
          </View>
          <View style={styles.hueRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Decrease hue" onPress={() => stepHue(-5)} style={[styles.hueButton, { borderColor: c.border }]}><Feather name="minus" size={16} color={c.foreground} /></Pressable>
            <View accessibilityLabel="Color hue" accessibilityRole="adjustable" accessibilityHint="Drag the hue track, use the adjacent hue buttons, or enter a hex color." accessibilityValue={{ min: 0, max: 360, now: Math.round(hsv.h) }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === "increment" || event.nativeEvent.actionName === "decrement") stepHue(event.nativeEvent.actionName === "increment" ? 5 : -5); }} onLayout={event => { hueWidth.current = event.nativeEvent.layout.width; }} {...huePan.panHandlers} style={[styles.hueTrack, webGestureStyle]}>
              <LinearGradient pointerEvents="none" colors={RAINBOW} start={{ x: 0, y: .5 }} end={{ x: 1, y: .5 }} style={StyleSheet.absoluteFillObject} />
              <View pointerEvents="none" style={[styles.hueMarker, { left: `${hsv.h / 360 * 100}%` }]} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Increase hue" onPress={() => stepHue(5)} style={[styles.hueButton, { borderColor: c.border }]}><Feather name="plus" size={16} color={c.foreground} /></Pressable>
          </View>
          <View style={styles.previewRow}><View accessibilityLabel="Selected color preview" style={[styles.preview, { backgroundColor: preview, borderColor: c.border }]}><Feather name="check" size={22} color={calendarHighlightText(preview)} /></View><View style={styles.flex}><Text style={[styles.label, { color: c.foreground }]}>Selected color</Text><Text style={[styles.hexValue, { color: c.foreground }]}>{normalized ?? "Enter a valid hex"}</Text></View></View>
          <View style={styles.field}><Text style={[styles.label, { color: c.foreground }]}>Hex color</Text><TextInput accessibilityLabel="Custom color hex" value={hex} onChangeText={value => { setHex(value);const next = hexToHsv(value);if (next) { hsvRef.current = next;setHsv(next); } }} placeholder="#12ab34" placeholderTextColor={c.mutedForeground} autoCapitalize="none" autoCorrect={false} maxLength={16} style={[styles.input, { color: c.foreground, backgroundColor: c.card, borderColor: normalized ? c.border : c.destructive }]} />{!normalized ? <Text accessibilityRole="alert" style={[styles.copy, { color: c.destructive }]}>Enter #RGB or #RRGGBB. Transparency and color names are not supported.</Text> : null}</View>
          <Text style={[styles.copy, { color: c.mutedForeground }]}>Your chosen hex is saved. FlowLedger may use a lighter or darker accent shade so text and controls stay readable.</Text>
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel custom color" onPress={onCancel} style={[styles.action, { backgroundColor: c.card, borderColor: c.border }]}><Text style={[styles.actionText, { color: c.foreground }]}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Apply custom color" accessibilityState={{ disabled: !normalized }} disabled={!normalized} onPress={() => { if (normalized) onApply(normalized); }} style={[styles.action, { backgroundColor: c.primary, borderColor: c.primary, opacity: normalized ? 1 : .4 }]}><Text style={[styles.actionText, { color: c.primaryForeground }]}>Apply</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(2,6,23,.7)" }, sheet: { width: "100%", maxWidth: 440, maxHeight: "92%", borderWidth: 1, borderRadius: 22, overflow: "hidden" },
  header: { padding: 16, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 }, title: { fontSize: 18, fontFamily: "Inter_700Bold" }, flex: { flex: 1, minWidth: 0 }, close: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0 }, body: { padding: 18, gap: 15 }, copy: { fontSize: 12, lineHeight: 18 }, square: { height: 190, borderRadius: 12, overflow: "hidden" }, marker: { position: "absolute", width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#ffffff", transform: [{ translateX: -8 }, { translateY: -8 }], shadowColor: "#000000", shadowOpacity: .8, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  hueRow: { flexDirection: "row", alignItems: "center", gap: 8 }, hueButton: { width: 40, height: 40, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" }, hueTrack: { height: 28, flex: 1, borderRadius: 10, overflow: "hidden" }, hueMarker: { position: "absolute", top: 0, bottom: 0, width: 8, borderWidth: 2, borderColor: "#ffffff", borderRadius: 4, transform: [{ translateX: -4 }] },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12 }, preview: { width: 50, height: 50, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center" }, hexValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 }, label: { fontSize: 13, fontFamily: "Inter_600SemiBold" }, field: { gap: 7 }, input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, fontFamily: "Inter_500Medium" },
  footer: { borderTopWidth: 1, flexDirection: "row", padding: 16, gap: 10 }, action: { minHeight: 46, borderWidth: 1, borderRadius: 12, flex: 1, alignItems: "center", justifyContent: "center" }, actionText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});

import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText } from "@/components/AppText";
import { useColors } from "@/hooks/useColors";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import { adjacentChipScrollOffset, chipScrollMaximum } from "@/lib/chipScroll";

type Props = {
  values: Array<{ id: string; label: string }>;
  selected: string;
  onSelect: (id: string) => void;
  desktopDebtNavigation?: boolean;
};

export function SimulatorChoiceChips({ values, selected, onSelect, desktopDebtNavigation = false }: Props) {
  const c = useColors();
  const isDesktop = useDesktopExperience();
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [chipPositions, setChipPositions] = useState<Record<string, number>>({});
  const boundariesReady = values.every(value => Number.isFinite(chipPositions[value.id]));
  useEffect(() => {
    const ids = new Set(values.map(value => value.id));
    setChipPositions(previous => {
      const entries = Object.entries(previous).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    });
  }, [values]);
  // Reserve the two controls' space even when hidden so long-label wrapping
  // cannot make arrow visibility oscillate as the viewport changes.
  const debtChipMaxWidth = Math.max(1, Math.min(viewportWidth, containerWidth - 94));
  const maximum = chipScrollMaximum(viewportWidth, contentWidth);
  const showArrows = desktopDebtNavigation && isDesktop && containerWidth > 0 && contentWidth > containerWidth + 1;
  useEffect(() => {
    if (offsetRef.current <= maximum) return;
    offsetRef.current = maximum;
    setOffset(maximum);
    scrollRef.current?.scrollTo({ x: maximum, animated: false });
  }, [maximum]);
  const scroll = (direction: -1 | 1) => {
    const next = adjacentChipScrollOffset(offsetRef.current, viewportWidth, contentWidth, direction, values.map(value => chipPositions[value.id]));
    offsetRef.current = next;
    setOffset(next);
    scrollRef.current?.scrollTo({ x: next, animated: true });
  };
  const arrow = (direction: -1 | 1) => {
    const disabled = !boundariesReady || (direction < 0 ? offset <= 1 : offset >= maximum - 1);
    return <Pressable accessibilityRole="button" accessibilityLabel={direction < 0 ? "Previous debt choices" : "Next debt choices"} accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={() => scroll(direction)} style={[styles.arrow, { borderColor: c.border, opacity: disabled ? 0.35 : 1 }]}><Feather name={direction < 0 ? "chevron-left" : "chevron-right"} size={18} color={c.primary} /></Pressable>;
  };
  return <View style={styles.row} onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}>
    {showArrows ? arrow(-1) : null}
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.scroll}
      onLayout={event => setViewportWidth(event.nativeEvent.layout.width)}
      onContentSizeChange={width => setContentWidth(width)}
      scrollEventThrottle={16}
      onScroll={event => { const next = Math.max(0, Math.min(maximum, event.nativeEvent.contentOffset.x)); offsetRef.current = next; setOffset(next); }}>
      {values.map(value => {
        const active = value.id === selected;
        return <Pressable key={value.id} onLayout={event => { const x = event.nativeEvent.layout.x; setChipPositions(previous => previous[value.id] === x ? previous : { ...previous, [value.id]: x }); }} accessibilityRole="radio" aria-checked={active} accessibilityState={{ checked: active }} onPress={() => onSelect(value.id)} style={({ pressed }) => [styles.chip, desktopDebtNavigation && isDesktop && viewportWidth > 0 ? { maxWidth: debtChipMaxWidth } : null, { backgroundColor: active ? c.primary : c.background, borderColor: active ? c.primary : c.border, opacity: pressed ? 0.75 : 1 }]}>
          <AppText style={[styles.chipText, { color: active ? c.primaryForeground : c.foreground }]}>{value.label}</AppText>
        </Pressable>;
      })}
    </ScrollView>
    {showArrows ? arrow(1) : null}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 },
  arrow: { width: 40, height: 44, flexShrink: 0, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 1, flexShrink: 1, minWidth: 0 }, chips: { gap: 7, paddingRight: 2 },
  chip: { minHeight: 44, flexShrink: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  chipText: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_700Bold" },
});

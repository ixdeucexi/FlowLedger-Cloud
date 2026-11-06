import Feather from "@expo/vector-icons/Feather";
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { PrivacyPressable as Pressable, PrivacyText as Text, PrivacyView as View } from "@/components/privacy/PrivacyPrimitives";
import type { Bill } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

const FREQUENCIES: ReadonlyArray<{ value: Bill["frequency"]; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "yearly", label: "Yearly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "weekly", label: "Weekly" },
];

export function BillFrequencyPicker({ value, onChange, debt, open, onOpenChange, disabled = false }: {
  value: Bill["frequency"];
  onChange: (value: Bill["frequency"]) => void;
  debt: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const rootRef = useRef<React.ElementRef<typeof View>>(null);
  const triggerRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const handledEscapeRef = useRef(false);
  const optionRefs = useRef<Partial<Record<Bill["frequency"], React.ElementRef<typeof Pressable> | null>>>({});
  const options = FREQUENCIES.filter(option => !debt || option.value !== "yearly");
  const selected = FREQUENCIES.find(option => option.value === value);
  const close = () => { onOpenChange(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const frame = requestAnimationFrame(() => optionRefs.current[value]?.focus());
    const outside = (event: PointerEvent | FocusEvent) => {
      const root = rootRef.current as unknown as HTMLElement | null;
      if (root && !root.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [open, value, onOpenChange]);

  const keyboardProps = Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent) => {
      if (disabled) return;
      if (event.key === "Escape") {
        if (open) {
          handledEscapeRef.current = true;
          event.preventDefault(); event.stopPropagation(); close();
        } else if (!event.repeat) handledEscapeRef.current = false;
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (!open) { onOpenChange(true); return; }
      const index = options.findIndex(option => (optionRefs.current[option.value] as unknown) === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (Math.max(0, index) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      optionRefs.current[options[next].value]?.focus();
    },
    // RN Web Modal dismisses on keyup. Consume the same physical key after
    // closing the menu on keydown, while allowing the next Escape to close the editor.
    onKeyUp: (event: React.KeyboardEvent) => {
      if (event.key !== "Escape" || !handledEscapeRef.current) return;
      handledEscapeRef.current = false;
      event.preventDefault(); event.stopPropagation();
    },
  } : {};

  return <View ref={rootRef} {...keyboardProps} style={styles.root}>
    <Pressable ref={triggerRef} accessibilityRole="button" accessibilityLabel="Frequency"
      accessibilityValue={{ text: selected?.label ?? "Monthly" }} accessibilityState={{ expanded: open, disabled }} aria-expanded={open}
      disabled={disabled} onPress={() => onOpenChange(!open)}
      style={[styles.trigger, { backgroundColor: c.background, borderColor: open ? c.primary : c.border, opacity: disabled ? 0.5 : 1 }]}>
      <Feather name="repeat" size={17} color={c.primary} />
      <Text style={[styles.label, { color: c.foreground }]}>{selected?.label ?? "Monthly"}</Text>
      <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={c.mutedForeground} />
    </Pressable>
    {open ? <View accessibilityRole="radiogroup" accessibilityLabel="Bill frequency" style={[styles.list, { backgroundColor: c.background, borderColor: c.border }]}>
      {options.map(option => <Pressable key={option.value} ref={node => { optionRefs.current[option.value] = node; }}
        accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: value === option.value, disabled }} disabled={disabled}
        aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1}
        onPress={() => { onChange(option.value); close(); }}
        {...(Platform.OS === "web" ? { onKeyDown: (event: React.KeyboardEvent) => {
          if (disabled || (event.key !== " " && event.key !== "Spacebar")) return;
          event.preventDefault(); event.stopPropagation(); onChange(option.value); close();
        } } : {})}
        style={({ pressed }) => [styles.option, { backgroundColor: value === option.value ? c.primary + "18" : pressed ? c.muted : "transparent" }]}>
        <Text style={[styles.label, { color: value === option.value ? c.primary : c.foreground }]}>{option.label}</Text>
        {value === option.value ? <Feather name="check" size={18} color={c.primary} /> : null}
      </Pressable>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: 6 },
  trigger: { minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  label: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  list: { borderWidth: 1, borderRadius: 12, padding: 5 },
  option: { minHeight: 44, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
});

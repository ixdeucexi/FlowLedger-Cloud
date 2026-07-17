import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { MONTH_NAMES } from "@/lib/dateLabels";
const DOW_LABELS  = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function pad(n: number) { return String(n).padStart(2, "0"); }

function parseYMD(ymd: string): { y: number; m: number; d: number } | null {
  if (!ymd) return null;
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { y: parts[0], m: parts[1], d: parts[2] };
}

function formatDisplay(ymd: string) {
  const p = parseYMD(ymd);
  if (!p) return "";
  return `${MONTH_NAMES[p.m - 1]} ${p.d}, ${p.y}`;
}

interface DatePickerFieldProps {
  value: string;           // YYYY-MM-DD or ""
  onChange: (ymd: string) => void;
  placeholder?: string;
  optional?: boolean;      // show "Clear" button
  minDate?: string;        // YYYY-MM-DD — days before this are greyed out
  maxDate?: string;        // YYYY-MM-DD — days after this are greyed out
  label?: string;
}

export function DatePickerField({ value, onChange, placeholder = "Pick a date…", optional, minDate, maxDate, label }: DatePickerFieldProps) {
  const c = useColors();

  const today = new Date();
  const initDate = value || "";
  const initParsed = parseYMD(initDate);

  const [open, setOpen] = useState(false);
  const [pickerYear,  setPickerYear]  = useState(initParsed?.y ?? today.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(initParsed?.m ? initParsed.m - 1 : today.getMonth());

  const firstDOW = useMemo(
    () => new Date(pickerYear, pickerMonth, 1).getDay(),
    [pickerYear, pickerMonth]
  );
  const daysInMonth = useMemo(
    () => new Date(pickerYear, pickerMonth + 1, 0).getDate(),
    [pickerYear, pickerMonth]
  );

  const minParsed = parseYMD(minDate ?? "");
  const maxParsed = parseYMD(maxDate ?? "");

  const isDisabled = (day: number) => {
    const candidate = pickerYear * 10000 + (pickerMonth + 1) * 100 + day;
    const minimum = minParsed ? minParsed.y * 10000 + minParsed.m * 100 + minParsed.d : undefined;
    const maximum = maxParsed ? maxParsed.y * 10000 + maxParsed.m * 100 + maxParsed.d : undefined;
    return (minimum !== undefined && candidate < minimum) || (maximum !== undefined && candidate > maximum);
  };

  const shiftMonth = (dir: number) => {
    let m = pickerMonth + dir;
    let y = pickerYear;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setPickerMonth(m);
    setPickerYear(y);
  };

  const selectDay = (day: number) => {
    if (isDisabled(day)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ymd = `${pickerYear}-${pad(pickerMonth + 1)}-${pad(day)}`;
    onChange(ymd);
    setOpen(false);
  };

  const currentParsed = parseYMD(value);
  const selectedDay =
    currentParsed &&
    currentParsed.y === pickerYear &&
    currentParsed.m - 1 === pickerMonth
      ? currentParsed.d
      : null;

  return (
    <View>
      {label !== undefined && (
        <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      )}

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (!open && value) {
            const p = parseYMD(value);
            if (p) { setPickerYear(p.y); setPickerMonth(p.m - 1); }
          }
          setOpen(o => !o);
        }}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: c.muted,
            borderColor: open ? c.primary : "transparent",
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Feather name="calendar" size={15} color={open ? c.primary : c.mutedForeground} />
        <Text style={[styles.btnText, { color: value ? c.foreground : c.mutedForeground }]}>
          {value ? formatDisplay(value) : placeholder}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={c.mutedForeground} />
      </Pressable>

      {open && (
        <View style={[styles.panel, { backgroundColor: c.card, borderColor: c.border }]}>
          {/* Month navigation */}
          <View style={[styles.monthNav, { backgroundColor: c.muted }]}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={styles.navBtn}>
              <Feather name="chevron-left" size={18} color={c.foreground} />
            </Pressable>
            <Text style={[styles.monthLabel, { color: c.foreground }]}>
              {MONTH_NAMES[pickerMonth]} {pickerYear}
            </Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={styles.navBtn}>
              <Feather name="chevron-right" size={18} color={c.foreground} />
            </Pressable>
          </View>

          {/* DOW headers */}
          <View style={styles.dowRow}>
            {DOW_LABELS.map(d => (
              <Text key={d} style={[styles.dowLabel, { color: c.mutedForeground }]}>{d}</Text>
            ))}
          </View>

          {/* Day grid with proper offset */}
          <View style={styles.grid}>
            {[
              ...Array(firstDOW).fill(null),
              ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
            ].map((day, idx) => {
              if (day === null) return <View key={`e${idx}`} style={styles.cell} />;
              const sel = day === selectedDay;
              const dis = isDisabled(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => selectDay(day)}
                  disabled={dis}
                  style={({ pressed }) => [
                    styles.cell,
                    {
                      backgroundColor: sel ? c.primary : c.muted,
                      borderRadius: 8,
                      opacity: dis ? 0.25 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.cellText, { color: sel ? c.primaryForeground : c.foreground }]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Clear button (optional fields) */}
          {optional && value && (
            <Pressable
              onPress={() => { onChange(""); setOpen(false); }}
              style={[styles.clearBtn, { borderTopColor: c.border }]}
            >
              <Feather name="x" size={13} color={c.mutedForeground} />
              <Text style={[styles.clearText, { color: c.mutedForeground }]}>Clear date</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: 0.7 },
  btn: { flexDirection: "row", alignItems: "center", gap: 10, height: 48, borderRadius: 10, paddingHorizontal: 14, borderWidth: 1.5 },
  btnText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  panel: { borderRadius: 12, borderWidth: 1, padding: 10, marginTop: 6, marginBottom: 4 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 10 },
  navBtn: { padding: 4 },
  monthLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  dowRow: { flexDirection: "row", marginBottom: 4 },
  dowLabel: { width: "14.285714%", textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285714%", height: 38, alignItems: "center", justifyContent: "center" },
  cellText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  clearBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  clearText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});

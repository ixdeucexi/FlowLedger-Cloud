import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { AppText } from "./AppText";
import { useColors } from "@/hooks/useColors";
export type ScenarioPickerOption = { key: string; name: string; source: string };
export function ScenarioOptionPicker({ label, options, selectedKey, onSelect, disabled = false }: { label: string; options: ScenarioPickerOption[]; selectedKey: string | null; onSelect: (key: string) => void; disabled?: boolean }) {
  const c = useColors();const [open, setOpen] = useState(false);const [query, setQuery] = useState("");
  const selected = options.find(option => option.key === selectedKey);
  const filtered = options.filter(option => `${option.name} ${option.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <View style={styles.root}>
    <AppText style={[styles.label, { color: c.mutedForeground }]}>{label}</AppText>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => { setOpen(value => !value);setQuery(""); }} style={[styles.trigger, { backgroundColor: c.background, borderColor: c.border, opacity: disabled ? 0.5 : 1 }]}><View style={styles.copy}><AppText style={[styles.name, { color: c.foreground }]}>{selected?.name ?? "Choose a saved scenario"}</AppText>{selected ? <AppText style={[styles.source, { color: c.mutedForeground }]}>{selected.source}</AppText> : null}</View><Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={c.primary} /></Pressable>
    {open ? <View style={[styles.list, { borderColor: c.border, backgroundColor: c.background }]}>
      <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} placeholder="Search saved scenarios" placeholderTextColor={c.mutedForeground} value={query} onChangeText={setQuery} style={[styles.search, { color: c.foreground, borderColor: c.border }]} />
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>{filtered.map(option => <Pressable key={option.key} accessibilityRole="radio" accessibilityLabel={`${option.source}: ${option.name}`} accessibilityState={{ checked: selectedKey === option.key }} aria-checked={selectedKey === option.key} onPress={() => { setOpen(false);setQuery("");onSelect(option.key); }} style={[styles.option, { borderColor: c.border, backgroundColor: selectedKey === option.key ? c.primary + "15" : "transparent" }]}><View style={styles.copy}><AppText style={[styles.name, { color: c.foreground }]}>{option.name}</AppText><AppText style={[styles.source, { color: c.mutedForeground }]}>{option.source}</AppText></View>{selectedKey === option.key ? <Feather name="check" size={18} color={c.primary} /> : null}</Pressable>)}{!filtered.length ? <AppText style={[styles.empty, { color: c.mutedForeground }]}>No matching saved scenarios.</AppText> : null}</ScrollView>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ root: { minWidth: 0, gap: 7 }, label: { fontSize: 12, fontFamily: "Inter_700Bold" }, trigger: { minHeight: 52, borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }, copy: { flex: 1, minWidth: 0 }, name: { fontSize: 13, fontFamily: "Inter_700Bold", flexShrink: 1 }, source: { fontSize: 11, marginTop: 3 }, list: { borderWidth: 1, borderRadius: 13, padding: 8 }, search: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 13, marginBottom: 6 }, scroll: { maxHeight: 230 }, option: { minHeight: 54, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 8 }, empty: { fontSize: 12, padding: 12 } });

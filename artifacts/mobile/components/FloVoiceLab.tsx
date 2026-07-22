import { Feather } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import type { Voice } from "expo-speech";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { loadFloVoiceIdentifier, saveFloVoiceIdentifier } from "@/lib/floVoicePreference";

const PREVIEW_MESSAGE = "Hi, I’m Flo. I’ll help you understand your money one step at a time.";

function sortVoices(voices: Voice[]) {
  return [...voices].sort((left, right) => {
    const leftEnglish = left.language.toLowerCase().startsWith("en") ? 0 : 1;
    const rightEnglish = right.language.toLowerCase().startsWith("en") ? 0 : 1;
    return leftEnglish - rightEnglish
      || left.language.localeCompare(right.language)
      || left.name.localeCompare(right.name);
  });
}

export function FloVoiceLab() {
  const c = useColors();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null);
  const [previewingIdentifier, setPreviewingIdentifier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refreshVoices = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [available, savedIdentifier] = await Promise.all([
        Speech.getAvailableVoicesAsync(),
        loadFloVoiceIdentifier(),
      ]);
      const sorted = sortVoices(available);
      setVoices(sorted);
      if (savedIdentifier && !sorted.some(voice => voice.identifier === savedIdentifier)) {
        await saveFloVoiceIdentifier(null);
        setSelectedIdentifier(null);
        setMessage("That saved voice is no longer on this device, so Flo will use the device default.");
      } else {
        setSelectedIdentifier(savedIdentifier);
      }
    } catch {
      setVoices([]);
      setMessage("This device did not share its installed voices. Flo can still use the device default.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshVoices();
    return () => { void Speech.stop(); };
  }, [refreshVoices]);

  const englishVoiceCount = useMemo(
    () => voices.filter(voice => voice.language.toLowerCase().startsWith("en")).length,
    [voices],
  );

  const previewVoice = async (voice: Voice) => {
    await Speech.stop();
    setPreviewingIdentifier(voice.identifier);
    Speech.speak(PREVIEW_MESSAGE, {
      voice: voice.identifier,
      rate: 0.94,
      pitch: 1.03,
      onDone: () => setPreviewingIdentifier(null),
      onStopped: () => setPreviewingIdentifier(null),
      onError: () => {
        setPreviewingIdentifier(null);
        setMessage("That voice could not play. Try another installed voice.");
      },
    });
  };

  const selectVoice = async (identifier: string | null) => {
    await saveFloVoiceIdentifier(identifier);
    setSelectedIdentifier(identifier);
    setMessage(identifier ? "Flo will use this voice during setup on this device." : "Flo will use this device’s default voice.");
  };

  return (
    <View style={[styles.container, { backgroundColor: c.primary + "0D", borderColor: c.primary + "38" }]}>
      <View style={styles.headerRow}>
        <View style={[styles.icon, { backgroundColor: c.primary + "1F" }]}>
          <Feather name="volume-2" size={19} color={c.primary} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: c.foreground }]}>Admin Flo Voice Lab</Text>
          <Text style={[styles.description, { color: c.mutedForeground }]}>Preview voices installed on this device. Your choice stays on this device and does not change household data.</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <Text style={[styles.summary, { color: c.mutedForeground }]}>
          {loading ? "Checking this device…" : `${voices.length} voices found · ${englishVoiceCount} English`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh installed voices"
          disabled={loading}
          onPress={() => void refreshVoices()}
          style={({ pressed }) => [styles.refreshButton, { borderColor: c.border, opacity: pressed || loading ? 0.55 : 1 }]}
        >
          <Feather name="refresh-cw" size={14} color={c.primary} />
          <Text style={[styles.refreshText, { color: c.primary }]}>Refresh</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use device default voice"
        onPress={() => void selectVoice(null)}
        style={[styles.voiceRow, { borderColor: selectedIdentifier === null ? c.primary : c.border, backgroundColor: selectedIdentifier === null ? c.primary + "12" : c.card }]}
      >
        <View style={styles.voiceCopy}>
          <Text style={[styles.voiceName, { color: c.foreground }]}>Device default</Text>
          <Text style={[styles.voiceDetails, { color: c.mutedForeground }]}>Uses the voice selected in your phone or browser settings.</Text>
        </View>
        <Feather name={selectedIdentifier === null ? "check-circle" : "circle"} size={19} color={selectedIdentifier === null ? c.success : c.mutedForeground} />
      </Pressable>

      {voices.map(voice => {
        const selected = voice.identifier === selectedIdentifier;
        const previewing = voice.identifier === previewingIdentifier;
        return (
          <View key={voice.identifier} style={[styles.voiceRow, { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary + "12" : c.card }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Select ${voice.name} voice`}
              onPress={() => void selectVoice(voice.identifier)}
              style={styles.voiceCopy}
            >
              <Text style={[styles.voiceName, { color: c.foreground }]} numberOfLines={2}>{voice.name}</Text>
              <Text style={[styles.voiceDetails, { color: c.mutedForeground }]}>{voice.language} · {String(voice.quality).toLowerCase()}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewing ? `Stop ${voice.name} preview` : `Preview ${voice.name}`}
              onPress={() => previewing ? void Speech.stop() : void previewVoice(voice)}
              style={[styles.previewButton, { backgroundColor: c.primary + "18" }]}
            >
              <Feather name={previewing ? "square" : "play"} size={14} color={c.primary} />
              <Text style={[styles.previewText, { color: c.primary }]}>{previewing ? "Stop" : "Hear"}</Text>
            </Pressable>
            <Feather name={selected ? "check-circle" : "circle"} size={19} color={selected ? c.success : c.mutedForeground} />
          </View>
        );
      })}

      {!loading && voices.length === 0 ? (
        <Text style={[styles.empty, { color: c.mutedForeground }]}>No named voices were reported. Flo will use the device default.</Text>
      ) : null}
      {message ? <Text style={[styles.message, { color: c.primary }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 13, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  title: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  description: { fontSize: 11, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 2 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  summary: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  refreshButton: { minHeight: 34, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  refreshText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  voiceRow: { minHeight: 60, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  voiceCopy: { flex: 1 },
  voiceName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  voiceDetails: { fontSize: 10, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 2 },
  previewButton: { minHeight: 34, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  previewText: { fontSize: 10, fontFamily: "Inter_800ExtraBold" },
  empty: { fontSize: 11, lineHeight: 17, fontFamily: "Inter_500Medium" },
  message: { fontSize: 11, lineHeight: 17, fontFamily: "Inter_700Bold" },
});


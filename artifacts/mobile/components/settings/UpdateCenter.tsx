import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useMembership } from "@/context/MembershipContext";
import { supabase } from "@/lib/supabase";
import { submitFeedback } from "@/lib/feedbackApi";
import { type AppFeedbackRow, feedbackStatusLabel, sanitizeFeedbackMessage, canSubmitFeedback } from "@/lib/feedback";
import { UPDATE_CENTER_SCREEN, updateRequestHistory } from "@/lib/updateCenter";

export function UpdateCenter({ light = false }: { light?: boolean }) {
  const { user } = useAuth();
  const { isAdmin } = useMembership();
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rows, setRows] = useState<AppFeedbackRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sending = useRef(false);
  const historyGeneration = useRef(0);
  const identity = `${user?.id ?? ""}:${isAdmin}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const loadHistory = useCallback(async () => {
    if (!isAdmin || !user?.id) return;
    const requestedIdentity = `${user.id}:${isAdmin}`;
    const generation = ++historyGeneration.current;
    const isCurrent = () => currentIdentity.current === requestedIdentity && historyGeneration.current === generation;
    setLoading(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase.from("app_feedback").select("*")
        .eq("user_id", user.id).eq("screen", UPDATE_CENTER_SCREEN)
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      if (isCurrent()) setRows(updateRequestHistory((data ?? []) as AppFeedbackRow[], user.id));
    } catch {
      if (isCurrent()) setHistoryError("Your saved requests could not be loaded. Try again.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [isAdmin, user?.id]);
  useEffect(() => {
    historyGeneration.current += 1;
    setRows([]); setMessage(""); setNotice(null); setHistoryError(null);
    void loadHistory();
  }, [loadHistory]);

  const submit = async () => {
    if (!isAdmin || !user?.id || sending.current) return;
    const cleaned = sanitizeFeedbackMessage(message);
    if (!canSubmitFeedback(cleaned)) { setNotice("Tell me a little more about the update you want."); return; }
    const requestedIdentity = identity;
    sending.current = true; setBusy(true); setNotice(null);
    try {
      await submitFeedback({ feedback_type: "idea", screen: UPDATE_CENTER_SCREEN, message: cleaned,
        rating: null, can_contact: false, app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? null, platform: Platform.OS });
      if (currentIdentity.current === requestedIdentity) {
        setMessage("");
        setNotice("Saved. When you're ready, tell Codex ‘complete updates’ in your chat so these requests can be reviewed. Nothing runs automatically.");
        void loadHistory();
      }
    } catch (error) {
      if (currentIdentity.current === requestedIdentity) setNotice(error instanceof Error ? error.message : "Could not save. Your request is still here—try again.");
    } finally { sending.current = false; setBusy(false); }
  };
  if (!isAdmin || !user) return null;
  const ink = light ? "#172033" : "#f7f8ff";
  const muted = light ? "#526078" : "#abb5cc";
  const surface = light ? "#ffffff" : "#10182b";
  return <View style={styles.container}>
    <View style={[styles.card, { backgroundColor: surface }]}>
      <Text style={[styles.title, { color: ink }]}>Update Center</Text>
      <Text style={[styles.body, { color: muted }]}>What would you like changed? Save one request at a time. I'll review them when you tell Codex to complete updates in your chat.</Text>
      <TextInput accessibilityLabel="Update request" multiline maxLength={4000} editable={!busy}
        placeholder="Describe the change you want…" placeholderTextColor={muted} value={message} onChangeText={setMessage}
        style={[styles.input, { color: ink, borderColor: light ? "#dce1ea" : "#33405b" }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Submit update request" disabled={busy || !canSubmitFeedback(message)}
        onPress={() => void submit()} style={[styles.button, (busy || !canSubmitFeedback(message)) && { opacity: 0.5 }]}>
        <Text style={styles.buttonText}>{busy ? "Saving…" : "Submit"}</Text>
      </Pressable>
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: ink }]}>{notice}</Text> : null}
    </View>
    <Text style={[styles.title, { color: ink }]}>Your requests</Text>
    <Text style={[styles.body, { color: muted }]}>Your most recent 100 requests. Status changes after review—not just because you submitted.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Refresh update requests" style={styles.refresh} disabled={loading} onPress={() => void loadHistory()}><Text style={styles.link}>{loading ? "Loading…" : "Refresh requests"}</Text></Pressable>
    {historyError ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: ink }]}>{historyError}</Text> : null}
    {!loading && !historyError && rows.length === 0 ? <Text style={[styles.body, { color: muted }]}>No requests yet. Your first update starts above.</Text> : null}
    {rows.map(row => <View key={row.id} style={[styles.card, { backgroundColor: surface }]}>
      <View style={styles.row}><Text style={styles.link}>{feedbackStatusLabel(row.status)}</Text><Text style={[styles.date, { color: muted }]}>{new Date(row.created_at).toLocaleDateString()}</Text></View>
      <Text selectable style={[styles.body, { color: ink }]}>{row.message}</Text>
      {row.admin_note ? <Text selectable style={[styles.body, { color: muted }]}>{row.admin_note}</Text> : null}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 14 }, card: { padding: 20, borderRadius: 20, gap: 14 },
  title: { fontSize: 21, fontFamily: "Inter_700Bold" }, body: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular" },
  input: { minHeight: 150, padding: 14, borderWidth: 1, borderRadius: 14, textAlignVertical: "top", fontSize: 16, fontFamily: "Inter_400Regular" },
  button: { backgroundColor: "#9546ef", borderRadius: 14, padding: 15, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontFamily: "Inter_700Bold" }, link: { color: "#a263ed", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, date: { fontSize: 12, fontFamily: "Inter_400Regular" },
  refresh: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 8 },
});

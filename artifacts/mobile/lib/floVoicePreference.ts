import AsyncStorage from "@react-native-async-storage/async-storage";

const FLO_VOICE_STORAGE_KEY = "flowledger_flo_voice_identifier";

export async function loadFloVoiceIdentifier(): Promise<string | null> {
  return AsyncStorage.getItem(FLO_VOICE_STORAGE_KEY);
}

export async function saveFloVoiceIdentifier(identifier: string | null): Promise<void> {
  if (identifier) {
    await AsyncStorage.setItem(FLO_VOICE_STORAGE_KEY, identifier);
    return;
  }
  await AsyncStorage.removeItem(FLO_VOICE_STORAGE_KEY);
}


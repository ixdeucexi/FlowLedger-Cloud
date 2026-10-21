import { Alert, Platform } from "react-native";

/** RN Web's Alert is a no-op; validation must be visible before any write. */
export function showFormError(title: string, message: string): void {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

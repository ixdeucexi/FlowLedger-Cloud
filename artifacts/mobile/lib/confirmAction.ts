import { Alert, Platform } from "react-native";

type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<unknown>;
};

function webConfirm(title: string, message: string) {
  const maybeConfirm = (globalThis as typeof globalThis & { confirm?: (message?: string) => boolean }).confirm;
  if (typeof maybeConfirm !== "function") return true;
  return maybeConfirm(`${title}\n\n${message}`);
}

export function confirmAction({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmActionOptions) {
  const run = () => { void onConfirm(); };

  if (Platform.OS === "web") {
    if (webConfirm(title, message)) run();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: "cancel" },
    { text: confirmText, style: destructive ? "destructive" : "default", onPress: run },
  ]);
}

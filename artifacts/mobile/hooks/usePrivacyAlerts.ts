import { useMemo, useRef } from "react";
import { Alert, Platform } from "react-native";

import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { privateAlertText } from "@/lib/moneyPrivacy";

/** Mask presentation at invocation time, including alerts after asynchronous saves. */
export function usePrivacyAlerts() {
  const privacy = useMoneyPrivacy();
  const maskRef = useRef(privacy.mask);
  maskRef.current = privacy.mask;

  return useMemo(() => {
    const alert: typeof Alert.alert = (title, message, buttons, options) => {
      const mask = (text: string) => privateAlertText(text, maskRef.current);
      Alert.alert(
        mask(title),
        message === undefined ? undefined : mask(message),
        buttons?.map((button) => ({
          ...button,
          ...(button.text === undefined ? {} : { text: mask(button.text) }),
        })),
        options,
      );
    };
    const formError = (title: string, message: string) => {
      const mask = (text: string) => privateAlertText(text, maskRef.current);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.alert(`${mask(title)}\n\n${mask(message)}`);
      } else {
        alert(title, message);
      }
    };
    return { alert, formError };
  }, []);
}

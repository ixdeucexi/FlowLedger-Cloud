import React, { forwardRef, useRef } from "react";
import {
  Text as NativeText, TextInput as NativeTextInput, View as NativeView, Pressable as NativePressable,
  type TextProps, type TextInputProps, type ViewProps, type PressableProps, type StyleProp, type ViewStyle,
} from "react-native";
import { useMoneyPrivacy } from "@/context/MoneyPrivacyContext";
import { HIDDEN_MONEY, maskMoneyText, moneyPrivacyAccessibility } from "@/lib/moneyPrivacy";
import { privateTextChildren } from "@/lib/moneyPrivacyChildren";
export { privateTextChildren } from "@/lib/moneyPrivacyChildren";


export type PrivacyText = NativeText;
export const PrivacyText = forwardRef<NativeText, TextProps & { sensitive?: boolean }>(function PrivacyText({ children, sensitive = false, ...props }, ref) {
  const { hidden } = useMoneyPrivacy();
  return <NativeText {...moneyPrivacyAccessibility(props, hidden, sensitive)} ref={ref}>{privateTextChildren(children, hidden, sensitive)}</NativeText>;
});

export type PrivacyView = NativeView;
export const PrivacyView = forwardRef<NativeView, ViewProps & { sensitive?: boolean }>(function PrivacyView({ sensitive = false, ...props }, ref) {
  const { hidden } = useMoneyPrivacy();
  return <NativeView {...moneyPrivacyAccessibility(props, hidden, sensitive)} ref={ref} />;
});

export const PrivacyPressable = forwardRef<NativeView, PressableProps & { sensitive?: boolean }>(function PrivacyPressable({ sensitive = false, ...props }, ref) {
  const { hidden } = useMoneyPrivacy();
  return <NativePressable {...moneyPrivacyAccessibility(props, hidden, sensitive)} ref={ref} />;
});

export type PrivacyTextInput = NativeTextInput;
export const PrivacyTextInput = forwardRef<NativeTextInput, TextInputProps & { sensitive?: boolean }>(function PrivacyTextInput({ sensitive = false, ...props }, ref) {
  const { hidden, setHidden } = useMoneyPrivacy();
  const draft = useRef(props.value ?? props.defaultValue ?? "");
  if (props.value !== undefined) draft.current = props.value;
  const shownValue = props.value ?? draft.current;
  if (hidden && (sensitive || maskMoneyText(shownValue, true) !== shownValue)) {
    return (
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel={props.editable === false ? "Show amounts" : "Show amounts to edit"}
        onPress={() => setHidden(false)}
        style={[props.style as StyleProp<ViewStyle>, { justifyContent: "center", minHeight: 42 }]}
      >
        <NativeText style={{ color: props.placeholderTextColor ?? "#64748b", fontSize: 14 }}>{HIDDEN_MONEY} · Show to {props.editable === false ? "view" : "edit"}</NativeText>
      </NativePressable>
    );
  }
  return <NativeTextInput {...moneyPrivacyAccessibility(props, hidden)} defaultValue={props.value === undefined ? draft.current : undefined} onChangeText={value => { draft.current = value; props.onChangeText?.(value); }} ref={ref} />;
});

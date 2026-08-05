import type { ViewStyle } from "react-native";

export const DESKTOP_MODAL_OVERLAY: ViewStyle = {
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 32,
  paddingVertical: 28,
  backgroundColor: "rgba(2, 6, 23, 0.78)",
};

const DESKTOP_MODAL_SURFACE: ViewStyle = {
  width: "100%",
  maxHeight: "86%",
  borderRadius: 24,
  borderWidth: 1,
  borderColor: "rgba(148, 163, 184, 0.18)",
  shadowColor: "#000000",
  shadowOpacity: 0.42,
  shadowRadius: 36,
  shadowOffset: { width: 0, height: 20 },
  elevation: 18,
};

export const DESKTOP_MODAL_COMPACT: ViewStyle = {
  ...DESKTOP_MODAL_SURFACE,
  maxWidth: 480,
};

export const DESKTOP_MODAL_REGULAR: ViewStyle = {
  ...DESKTOP_MODAL_SURFACE,
  maxWidth: 580,
};

export const DESKTOP_MODAL_WIDE: ViewStyle = {
  ...DESKTOP_MODAL_SURFACE,
  maxWidth: 660,
};

export const DESKTOP_MODAL_MATCH: ViewStyle = {
  ...DESKTOP_MODAL_SURFACE,
  maxWidth: 820,
  maxHeight: "80%",
};

export const DESKTOP_MODAL_HANDLE: ViewStyle = {
  display: "none",
};

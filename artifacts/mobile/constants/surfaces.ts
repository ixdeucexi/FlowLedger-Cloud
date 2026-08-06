export const surfaceTokens = {
  light: {
    standard: "rgba(255,255,255,0.98)",
    elevated: "#ffffff",
    glass: "rgba(255,255,255,0.92)",
    overlay: "rgba(255,255,255,0.985)",
    modal: "#ffffff",
  },
  dark: {
    standard: "rgba(15,23,42,0.95)",
    elevated: "rgba(12,20,44,0.985)",
    glass: "rgba(15,23,42,0.90)",
    overlay: "rgba(8,13,28,0.985)",
    modal: "rgba(6,10,22,0.995)",
  },
} as const;

export type SurfaceVariant = keyof typeof surfaceTokens.dark;

export function surfaceColor(mode: "light" | "dark", variant: SurfaceVariant) {
  return surfaceTokens[mode][variant];
}

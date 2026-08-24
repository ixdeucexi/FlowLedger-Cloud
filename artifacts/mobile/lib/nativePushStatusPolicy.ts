export type NativePushStatus = "unsupported" | "blocked" | "disabled" | "enabled" | "degraded";

export function reconcileNativePushStatus(input: {
  supported: boolean;
  permission: "granted" | "denied" | "undetermined";
  preferenceEnabled: boolean;
  serverRegistered: boolean | null;
}): NativePushStatus {
  if (!input.supported) return "unsupported";
  if (input.permission === "denied") return "blocked";
  if (!input.preferenceEnabled || input.permission !== "granted") return "disabled";
  return input.serverRegistered === true ? "enabled" : "degraded";
}

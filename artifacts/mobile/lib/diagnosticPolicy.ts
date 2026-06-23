export type DiagnosticEventType = "performance" | "save_failure" | "unhandled_error";
export type DiagnosticOperation = "data_load" | "forecast" | "amount_save" | "settings_save" | "app_error";

const SAFE_CODE = /^[a-z0-9_:-]{1,64}$/i;

export interface DiagnosticInput {
  eventType: DiagnosticEventType;
  operation: DiagnosticOperation;
  platform: "web" | "ios" | "android" | "unknown";
  durationMs?: number;
  errorCode?: string;
}

export function sanitizeDiagnostic(input: DiagnosticInput): DiagnosticInput {
  return {
    eventType: input.eventType,
    operation: input.operation,
    platform: ["web", "ios", "android"].includes(input.platform) ? input.platform : "unknown",
    durationMs: input.durationMs === undefined ? undefined : Math.max(0, Math.min(300_000, Math.round(input.durationMs))),
    errorCode: input.errorCode && SAFE_CODE.test(input.errorCode) ? input.errorCode : undefined,
  };
}

export function diagnosticErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  const prefix = error.message.split(":", 1)[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return SAFE_CODE.test(prefix) ? prefix : "operation_failed";
}

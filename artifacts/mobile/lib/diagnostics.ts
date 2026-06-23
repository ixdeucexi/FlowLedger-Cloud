import { supabase } from "@/lib/supabase";
import { sanitizeDiagnostic, type DiagnosticInput } from "@/lib/diagnosticPolicy";

export async function recordDiagnostic(userId: string | undefined, input: DiagnosticInput): Promise<void> {
  if (!userId) return;
  const safe = sanitizeDiagnostic(input);
  await supabase.from("app_diagnostics").insert({
    user_id: userId,
    app_version: "phase0",
    platform: safe.platform,
    event_type: safe.eventType,
    operation: safe.operation,
    error_code: safe.errorCode ?? null,
    duration_ms: safe.durationMs ?? null,
  });
}

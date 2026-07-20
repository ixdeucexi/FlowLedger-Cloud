import { supabase } from "@/lib/supabase";
import type { FeedbackType } from "@/lib/feedback";

export interface FeedbackSubmission {
  feedback_type: FeedbackType;
  screen: string;
  message: string;
  rating: number | null;
  can_contact: boolean;
  app_version: string | null;
  platform: string;
}

async function responseMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { message?: string };
  return payload.message || "Could not send feedback.";
}

export async function submitFeedback(submission: FeedbackSubmission) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in before sending feedback.");

  const response = await fetch("/api/feedback/submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submission),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
}

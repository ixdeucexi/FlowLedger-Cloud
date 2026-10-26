import { normalizeAccountName } from "./analysisAccounts.ts";

/** Strip one literal saved-name mention, never every matching year/month.
 * Prefer the mention attached to “bucket” over a coincident calendar qualifier. */
export function bucketQuestionHasUnsupportedScope(question: string, names: readonly string[]): boolean {
  let scope = ` ${normalizeAccountName(question)} `;
  const candidates = [...new Set(names.map(normalizeAccountName).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of candidates) {
    const needle = ` ${name} `;
    const attached = [scope.indexOf(`${needle}bucket`), scope.indexOf(`${needle}spending bucket`)].filter(index => index >= 0);
    const index = attached.length ? Math.min(...attached) : scope.indexOf(needle);
    if (index >= 0) { scope = scope.slice(0, index) + " " + scope.slice(index + needle.length); break; }
  }
  if (/\b(?:forecast|projected|future|afford|safely|tomorrow|yesterday|next|last|after|before|will|would)\b|\bwhat if\b/.test(scope)) return true;
  if (/\b(?:this|previous|following|current|past) (?:week|month|year|quarter|weekend)\b|\b(?:start|beginning|end|middle) of (?:(?:the|this|next|last) )?(?:week|month|year|quarter)\b/.test(scope)) return true;
  // Current relation words are not dates: “left in my [name] bucket” and
  // “earmarked for [name]” remain valid. Other cutoffs/periods are unsupported.
  const temporal = scope.replace(/\b(?:in|for|from|of|on) (?:(?:my|our|the|this|that) )?(?:spending )?bucket\b/g, " bucket ")
    .replace(/\b(?:as of today|for today|at present|at the moment|at this moment|right now|today|now|currently)\b/g, " ")
    .replace(/([\p{L}])(\d)|(\d)([\p{L}])/gu, (_, a, b, c, d) => `${a ?? c} ${b ?? d}`);
  if (/\b(?:on|by|as of|during|until|through|at) +\S/.test(temporal)) return true;
  if (/\bin +(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) +)?(?:days?|weeks?|months?|years?|quarters?)\b/.test(temporal)) return true;
  if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|q[1-4])\b/.test(temporal)) return true;
  const month = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  return /\b\d{4}\b/.test(temporal)
    || new RegExp(`\\b(?:in|for|from) (?:the )?${month}\\b`).test(temporal)
    || new RegExp(`\\b(?:${month} \\d{1,2}|\\d{1,2} ${month})\\b`).test(temporal)
    || /\b\d{1,4} \d{1,2}(?: \d{1,4})?\b/.test(temporal);
}

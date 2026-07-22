const INTERNAL_NOTE = /\s*\((?:record|records|field|fields)\s*:\s*[^)]+\)/gi;

const FRIENDLY_TERMS: Array<[RegExp, string]> = [
  [/\bbalanceToday\b/g, "today's balance"],
  [/\bsafetyFloor\b/g, "safety floor"],
  [/\bmonthlyRemaining\b/g, "money left this month"],
  [/\bbillsLeftAmount\b/g, "bill amount left"],
  [/\bbillsLeftCount\b/g, "bills left"],
  [/\bforecastConfidence\b/g, "forecast confidence"],
  [/\bdeterministic snapshot\b/gi, "FlowLedger plan"],
  [/\brevalidation\b/gi, "checking the latest numbers"],
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function compactFloText(text: string, maxWords = 65): string {
  const clean = String(text || "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean;
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;\-]+$/, "")}…`;
}

export function isWeakFloReply(text: string): boolean {
  return /(?:could(?:n't| not) form|no|without) (?:a )?reliable (?:account )?answer|unable to (?:answer|help)|not enough (?:reliable )?(?:data|information) to answer/i.test(String(text || ""));
}

function friendlyDate(_: string, yearText: string, monthText: string, dayText: string): string {
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return `${yearText}-${monthText}-${dayText}`;
  return `${MONTHS[month - 1]} ${day}, ${yearText}`;
}

export function humanizeFloText(text: string): string {
  let friendly = String(text || "").replace(INTERNAL_NOTE, "");
  FRIENDLY_TERMS.forEach(([pattern, replacement]) => {
    friendly = friendly.replace(pattern, replacement);
  });
  if (isWeakFloReply(friendly)) return "I couldn't finish that answer. Ask again and I'll use your latest numbers.";
  return compactFloText(friendly
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, friendlyDate)
    .replace(/(^|\n)[ \t]*-[ \t]+/g, "$1• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

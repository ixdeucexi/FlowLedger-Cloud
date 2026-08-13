export const FLOWLEDGER_USER_GUIDE_FILENAME = "FlowLedger-User-Guide.pdf";
export const FLOWLEDGER_USER_GUIDE_PATH = `/${FLOWLEDGER_USER_GUIDE_FILENAME}`;
export const FLOWLEDGER_PRODUCTION_ORIGIN = "https://flowledger-algo.com";
export const FLOWLEDGER_USER_GUIDE_ROUTE = "/user-guide";

export const FLOWLEDGER_USER_GUIDE_PAGE_TITLES = [
  "FlowLedger User Guide",
  "Start with a complete plan",
  "Your daily 3-minute routine",
  "Bills, debts, and planned payments",
  "Forecast and Plan Simulator",
  "Savings and Flo",
  "Notifications and in-app guidance",
  "When a number does not look right",
] as const;

export type FlowLedgerUserGuideTarget =
  | { kind: "mobile"; href: typeof FLOWLEDGER_USER_GUIDE_ROUTE }
  | { kind: "pdf"; href: string };

export function flowLedgerUserGuidePageFromOffset(
  offsetX: number,
  pageWidth: number,
  pageCount: number = FLOWLEDGER_USER_GUIDE_PAGE_TITLES.length,
) {
  if (!Number.isFinite(offsetX) || !Number.isFinite(pageWidth) || pageWidth <= 0) {
    return 0;
  }

  const lastPage = Math.max(0, Math.trunc(pageCount) - 1);
  return Math.max(0, Math.min(lastPage, Math.round(offsetX / pageWidth)));
}

export function flowLedgerUserGuideUrl(origin = FLOWLEDGER_PRODUCTION_ORIGIN) {
  return `${origin.replace(/\/+$/, "")}${FLOWLEDGER_USER_GUIDE_PATH}`;
}

export function flowLedgerUserGuideTarget(
  surface: "mobile" | "website",
  origin?: string,
): FlowLedgerUserGuideTarget {
  return surface === "website"
    ? { kind: "pdf", href: flowLedgerUserGuideUrl(origin) }
    : { kind: "mobile", href: FLOWLEDGER_USER_GUIDE_ROUTE };
}

export const FLOWLEDGER_USER_GUIDE_FILENAME = "FlowLedger-User-Guide.pdf";
export const FLOWLEDGER_USER_GUIDE_PATH = `/${FLOWLEDGER_USER_GUIDE_FILENAME}`;
export const FLOWLEDGER_PRODUCTION_ORIGIN = "https://flowledger-algo.com";

export function flowLedgerUserGuideUrl(origin = FLOWLEDGER_PRODUCTION_ORIGIN) {
  return `${origin.replace(/\/+$/, "")}${FLOWLEDGER_USER_GUIDE_PATH}`;
}

# Numeric layout audit

Live at https://flowledger-algo.com. READY production: `dpl_GmD96Cq7d1x1Gw6cLj6bUmPW3goK`. All four app aliases resolve to the verified source below.

Reviewed the main app and common dialogs for fractured numbers, hidden amounts, cropped signs, clipped years and neighboring text overlap. Repairs preserve financial values and formatting precision in full-detail views. Compact calendar labels are explicitly rounded; selecting a day shows its full amount and items.

| Area | Repairs |
| --- | --- |
| Dashboard | Checking, savings, goals and monthly-plan amounts get readable space; savings-card flips reserve enough height. |
| Bills and debt | Summary cards and list values reflow; debt metadata preserves complete years; weekly/extra-payment and lower planner facts fit. |
| Activity | Summary totals and transaction amounts remain complete. Category/type labels stay within their desktop columns and clear of account text and edit controls. |
| Forecast | Small calendar cells use K/M/B where necessary, including negative and near-$10,000 rounding cases. Full day details and existing accessibility labels remain available. |
| Reports and budgets | Narrow totals and comparison cards stack or wrap without chopping digits. |
| Simulator and matching | Results respond to their actual panel width; safety totals, planned payments, matching headers and variance rows reflow. |
| Flo and transaction forms | Inline currency signs stay with their amounts in web replies; long debt/account choices fit inside the sheet. |

Source checks cover all 24 owned implementation files; 13 changed main TSX files parse cleanly and 622 financial/navigation handler properties match the baseline. No calculations, stored financial records, backend functions, auth or billing behavior were changed. Flo keeps the original response characters and Privacy wrappers; its nonbreaking inline style is web-only.

Verification passed 1,515 mobile unit/contract tests and five performance checks, final combined mobile typecheck, Expo export, guide hash and artifact/config guards. Independent focused checks passed 26 Forecast tests and 18 privacy/Flo tests. The guide explains rounded calendar labels and selecting a day for the full amount; the 11-page PDF and its rendered Forecast page were checked.

Local browser evidence includes 80 phone stages, 99 desktop/tablet cases and 98 overlay stages, plus focused corrections bound to their exact exported bundles. Viewports include 320, 390, 768, 1,024 and 1,200 pixels, with 1,100 for the desktop net boundary, in light and dark themes. Cases use positive and negative million-dollar values, long names, wide digits, near-$10,000 rounding, dates, panel resizing, savings flips and Privacy hide/reveal. Financial and AI APIs are intercepted with fictional data; no customer/provider/financial writes or native hardware execution are claimed.

Intentional compact merchant labels, clamped nonfinancial table labels, and normal horizontal scrolling within editable amount inputs are recorded separately from complete monetary values. Confirmed numeric and overlap defects have no unresolved cases in the final local proof.

Application release source: `b71199ba2020a63b069a3d67f96ef22b2fed9f6b`. Final entry: `entry-bd76415530044d77ccec3ee6dfd2182e.js`, SHA-256 `0f7510975a3c535ee515ec0624cbb576817412f209d23e0e37f5dcd2ef018283`. Published verification passed 306 scoped render checks: 100 phone/extra/date-boundary stages, 108 desktop/tablet/main/modal/paint/net cases, and 98 overlay/resize/scroll stages. Exact final entry bytes were verified throughout; no unresolved numerical or painted-overlap issues, uncaught application errors, unknown requests or actual financial/provider writes remain. Startup, registered deep routes, health, missing resources, cache rules, service worker, guide PDF and source/alias HTTP postflight passed. One parallel cold-load Simulator readiness timeout was retained outside definitive proof and rerun successfully with a longer wait; it required no product changes.

Rollback: `rollback/prod-before-numeric-layout-audit-20261030-1431`, remotely verified against previous READY production `dpl_979XCUmB2FYU1gQXzmmgvJiNmYpQ`, source `c461e9082904c530fbedf8a2574638a7cce2a02d`. This frontend rollback remains compatible with the unchanged backend.

Evidence: [snapshot](release-snapshots/numeric-layout-audit-20261030/). Compressed JSON retains detailed case geometry and phase/source provenance; summaries are directly readable.

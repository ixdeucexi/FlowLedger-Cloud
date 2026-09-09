# Reliability and usability release — September 9, 2026

## Protected working release

- Source: `d6007b998e921413142bc53ef76fd39b79f18770`
- Remote annotated tag: `rollback/prod-before-competitive-polish-20260909`
- Exact production artifact: `dpl_FqGJ64tU6ub1tUhW4ZAnDfERAX6g`
- Emergency artifact rollback: `vercel rollback dpl_FqGJ64tU6ub1tUhW4ZAnDfERAX6g --yes`

The production deployment's reported source commit was checked before the tag
was created and pushed. No account data is included in this rollback; it protects
the application release. This upgrade must not migrate or alter financial data.

## Product direction

The owner authorized the review findings and considered UI improvements while
preserving FlowLedger's structure. Keep Dashboard, Bills, Activity, Forecast,
Settings, existing financial semantics, and the purple brand. Improve daily
tasks before adding more features or integrations.

Official competitor references reviewed on September 9, 2026:

- [Monarch budgeting](https://www.monarch.com/features/budgeting): clear progress,
  customizable budgeting, and non-monthly planning.
- [Monarch tracking](https://www.monarch.com/features/tracking): accessible
  transaction review and recurring bills in list/calendar views.
- [EveryDollar features](https://www.ramseysolutions.com/money/everydollar/features):
  quick spending review, personalized budgets, and progress tracking.
- [EveryDollar paycheck planning](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/11667520933773-Paycheck-Planning):
  date-aware planning and spending guidance.
- [YNAB goal tracking](https://www.ynab.com/features/goal-tracking): understandable
  progress and flexible plans when circumstances change.

These support a focus on clarity, control, and reliable daily workflows. They do
not establish feature parity or justify changing FlowLedger's accounting model.
Do not add bank integrations, copy another product's visual identity, or claim
the product now matches every competitor.

## Debt support

The owner also asked how FlowLedger can help people reduce debt while keeping up
with bills. Use the existing snowball planner, required minimums, cash-flow limit,
and Forecast integration. Make the priorities visible: cover bills and required
minimums first; extra payments are optional. When the forecast allows no extra,
provide a useful route back to Bills instead of framing that month as a failure.

The [CFPB debt action plan](https://files.consumerfinance.gov/f/documents/cfpb_your-money-your-goals_debt-action-plan_tool_2018-11.pdf)
describes keeping required minimums covered before applying extra funds to a
selected debt. The app's amount remains an estimate based on recorded inputs,
not a guarantee of affordability or a replacement for checking missing expenses.
No automatic payment execution or debt-consolidation product is added.

## Release acceptance

- Opening Bills does not run Debt-only payoff simulation or its long month scan.
- Bills uses a genuinely virtualized list; search works with existing filters,
  clear/reset, empty results, and row actions.
- Activity's relative date ranges update at midnight and after foregrounding;
  custom date ranges remain unchanged.
- Settings quick access remains a row of squares at ordinary mobile widths;
  essential text is readable and larger-font layouts can reflow.
- Flo's hide action is visible, accessible, and reversible; Flo remains reachable.
- The removed data-updated note stays removed.
- Existing minimum-payment, pending-payment, alert, and reschedule behavior is
  covered by regressions, without silently treating pending money as settled.
- Tests, typecheck, export, independent review, and production postflight pass.

## Performance evidence and limits

Before changes, the signed-out production browser fetched an initial JavaScript
entry of 5,109,970 decoded bytes (1,334,170 transferred bytes in that observation).
This is a payload baseline, not a measurement of the owner's phone or proof of
the cause of a two-second freeze. Report runtime and bundle changes separately.

The review browser did not have a signed-in account. A local fictional reviewer
server launch was rejected by the execution tool. Do not bypass that restriction,
use customer credentials, or fabricate real-device verification. Record the
checks actually completed and any remaining device/account validation gap.

## Verification evidence before release

- `pnpm run verify` passed: 188 API, 38 Edge contract, 26 release fixture,
  914 mobile, and 4 performance tests (1,170 total); full workspace typecheck;
  web export; configuration, user-guide, and artifact validation; audit gate.
- Expo Doctor: 18/18 checks passed.
- Initial export payload reduced by approximately 8.7% by importing only the
  existing Feather icon family; no visible icon redesign or route splitting.
- Isolated real MoreHub/React Native Web rendering at 320/390 px and simulated
  1.5x text scale. Browser geometry: three 114x114 controls at 390 px normally;
  three content-height 358x76 controls at enlarged scale, with no horizontal
  overflow. Icons and fonts are mocked in this layout-only harness, not a
  substitute for native device testing.
- The rendered test caught and fixed an ineffective undefined aspect-ratio
  override. The harness now asserts the actual emitted CSS classes.
- Restored the previously committed 1024px transparent Android monochrome logo;
  visually checked its F/drop silhouette against a dark browser background.
- Startup-shell contracts now reflect the already-approved transparent logo.
  Controller, noscript, parser, inertness, and executable-script guards remain.
- Security patch updates applied without new audit ignores; see `SECURITY.md`
  for the remaining moderate advisory and existing build-tool exceptions.

Debt calculations remain synchronous after the preparation indicator paints;
this release does not prove zero latency on the owner's device. Real signed-in
PWA cold-open, resume, full-list scrolling, and payment interaction checks remain
an explicit verification gap. No customer financial records were changed.

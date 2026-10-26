# FlowLedger deep scan and competitive comparison

Review date: October 26, 2026. Baseline: `96007c8f414ff22b2e43f5c664bec581bab64676`, the live source at the start of this review.

**Status: four confirmed defects are being fixed and independently reviewed. This report does not claim those changes are verified or live.** Final test results, migration status, release commit and deployment evidence must be added by the coordinating release pass.

## Assessment

FlowLedger already has a substantial budgeting and planning product: guided setup, a monthly plan, safe-to-spend guidance, paycheck planning, category assignments, spending buckets, transaction matching, debt strategies, a simulator, reports and household permissions. The immediate opportunity is to make these existing flows dependable and easy to understand, then close specific gaps in imports, transaction automation and category carryover.

The comparison does not support saying FlowLedger is uniquely capable of forecasting. Monarch Plus now documents cash-flow and net-worth forecasts, scenarios, life events and debt linkage; its forecasting documentation was updated October 20. Quicken Simplifi also offers projected cash flow. FlowLedger should compete through clear explanations, useful debt and affordability decisions, and consistent amounts across screens. A forecast feature by itself is not a defensible distinction.

For the planned January 2027 Play launch, correctness and submission evidence take priority over investment tracking, retirement planning or subscription-cancellation services. January is the owner's target, not a guarantee of Google approval.

## Scope and evidence

CORE inspected application source and exercised extracted real handlers with deterministic local fixtures. Four reproducible defects below are confirmed; broader observations are product gaps or recommendations. Competitor claims come from official public documentation reviewed on October 26, rather than paid-account testing. Monarch, YNAB, Rocket Money and Quicken Simplifi are useful comparison products, not an asserted app-store ranking.

The launch scope remains **Founding Free and manual-first**: no public new bank-link flow, purchase control or checkout. The owner's existing bank-connected household is an internal/admin exception. This review does not recommend expanding Plaid functionality. Financial data from real customers was not used to manufacture the reproductions, and no historical data repair is claimed.

## What FlowLedger already implements

- **Setup and daily guidance:** a personalized, resumable five-stage setup; a canonical monthly plan; safe-to-spend information; and paycheck guidance. Evidence: [setup](../artifacts/mobile/app/setup.tsx), [readiness](../artifacts/mobile/lib/setupReadiness.ts), [Dashboard model](../artifacts/mobile/lib/dashboardFinancialModel.ts) and [paycheck planning](../artifacts/mobile/lib/paycheckPlanning.ts).
- **Planning and buckets:** category assignments, moving assigned money and copying the previous month's assignments; buckets with manual/bank spending, purchase history, adjustments, removal, closing and reopening. These are existing capabilities. Copying assignments is **not** an actual category carryover balance. Evidence: [category planning](../artifacts/mobile/lib/categoryPlanning.ts), [budget screen](../artifacts/mobile/app/(tabs)/category-budget.tsx), [bucket details](../artifacts/mobile/components/BucketDetailModal.tsx) and [bucket amounts](../artifacts/mobile/lib/spendingBuckets.ts).
- **Review, debt and households:** pending/posted matching filters for bills, debt, manual transactions and buckets; learned match ranking; implemented debt/simulator strategies; household roles, invitations, switching and activity. A generic `TransactionRule` type and `applyTransactionRules` helper exist, but there is no shipped, persisted user rules manager. Evidence: [growth helpers](../artifacts/mobile/lib/competitiveGrowth.ts), [simulator](../artifacts/mobile/lib/planSimulator.ts), [debt domain](../artifacts/mobile/lib/debtPlanDomain.ts) and [Snowball planner](../artifacts/mobile/lib/snowballPlanner.ts).
- **Reports and operations:** flow/category/debt/goal trends, guides, deletion and accessibility contracts. The account model is checking/savings/cash, not a complete assets, investments and net-worth model. Existing import handlers parse and save; that does not establish a preview or column-mapping review flow. Evidence: [reports](../artifacts/mobile/components/ReportsInsightsView.tsx), [accounts](../artifacts/mobile/lib/accounts.ts) and [Settings/imports](../artifacts/mobile/app/(tabs)/more.tsx).

The older [upgrade roadmap](roadmap/flowledger-upgrade-roadmap-flo-full-app.md) lists some of these capabilities as future work. Treat source-backed current behavior as the inventory; do not spend another release rebuilding features already present.

## Comparison matrix

The competitor columns summarize documented capabilities; availability can depend on tier. The FlowLedger column describes the baseline, not unfinished fixes.

| Area | FlowLedger today | Monarch | Other comparison products | Product implication |
| --- | --- | --- | --- | --- |
| Budget structure | Monthly plan, category assignments and moves; no actual category carryover balance | Flex and Category budgeting, rollover and goals [M1] | YNAB assigns available cash and supports category carryover; Simplifi has a Spending Plan and Planned Spend rollover [Y1, Y2, S1, S2] | Design carryover as a financial feature with explicit rules, not a copy button relabel |
| Forecasts and scenarios | Dated cash-flow projections, affordability and debt/simulator strategies | Plus documents cash-flow/net-worth forecasting, scenarios, life events and debt linkage [M4] | Simplifi projects account cash flow [S4] | Explain inputs, assumptions and the lowest balance; avoid “only app that forecasts” claims |
| Transaction review | Matching filters, pending review and learned match ranking | Editing, splits, review tools and rules [M2] | Rocket Money Premium includes manual entries, splits, tags and rules; Simplifi documents transaction rules [R1, S3] | Improve review clarity and import handling before promising parity with every automation tool |
| User-controlled rules | Generic helper exists; no shipped rules manager | Documented rules [M2] | Rocket Money Premium and Simplifi document rules [R1, S3] | A persisted, editable merchant/category rules interface is a real gap |
| Buckets and savings | Spending-bucket lifecycle and purchase history; separate savings goals | Budget rollover and goals [M1] | YNAB targets; Simplifi savings/planned-spending tools [Y1, S1, S2] | Make reservations and remaining amounts understandable across the whole plan |
| Debt planning | Snowball/debt strategies, projected payoff and simulator | Debt linkage in Plus forecasting [M4] | YNAB includes a loan planner [Y1] | Demonstrate coherent debt decisions and their cash impact rather than claiming exclusive debt planning |
| Sharing | Household roles, invitations, switching and activity | Sharing details not separately assessed in this pass | YNAB Together supports six people with sharing history; Rocket Money supports two separate logins [Y1, Y3, R3] | Retain role and household isolation as explicit acceptance criteria |
| Reporting breadth | Flow, category, debt and goal trends | Reports, recurring list/calendar, net worth and investments [M3] | Rocket Money Premium includes net worth, export and desktop access [R1] | Explain why the plan changed before taking on a full investment/asset model |
| Bills and subscriptions | Bills, recurring planning and subscription-related review tools | Recurring list/calendar [M3] | Rocket Money documents bill/subscription management and Premium cancellation assistance/automatic savings [R1, R2] | Do not imply FlowLedger performs cancellation or moves customer money |

Simplifi's distinctions matter: its projected account cash flow excludes Planned Spend and Savings Goals, according to its cash-flow guide. Do not equate a budget's available amount with an account forecast, or suggest every competitor includes every commitment in the same number. Compare concrete scenarios and explain the chosen accounting model.

Numeric prices are intentionally omitted: Monarch Core/Plus feature boundaries and Simplifi promotions make a snapshot price table easy to misrepresent. Verify a specific tier before using a price or feature claim in marketing.

## Confirmed defects being repaired

| Priority | Reproduced behavior | Required outcome |
| --- | --- | --- |
| P1 — transfer integrity | Editing a paired transfer from −$100/+$100 to $150 saved −$150, then failed on the second write, leaving +$100: a false −$50 net change | Paired transfer operations must succeed or fail together, with correct create/edit/delete/restore guards |
| P1 — household state | A delayed debt refresh started in household A published its bills and transactions after the user switched to household B | Scope/generation checks must reject stale refresh results before publishing them |
| P2 — allocated edit consistency | A bank transaction changed from −$100 to −$150 while retaining a $100 review allocation; reports showed $100 while the cash ledger showed $150 | Block or safely reconcile financial edits that would leave review allocations inconsistent; keep ledger/report amounts coherent |
| P2 — statement account choice | Statement import offered only `active.slice(0, 4)`; a fifth active account could not be selected. The alert-based choice also had a cross-platform limitation | A working account-selection interface must reach every eligible account on phone and desktop |

The first three proofs are recorded in `/tmp/flowledger-deep-sentinel-repros.cjs` and its log, with source paths in `BudgetContext.tsx`, `AddTransactionModal.tsx` and the statement-import handlers in `more.tsx`. These temporary artifacts are investigation evidence, not durable customer records. Implementation is divided between the financial and import UI work, followed by independent SENTINEL review.

The transfer fix may require an atomic persistence contract; a sequence of writes with optimistic UI is insufficient evidence. Review failure, retry, role changes and household switching as well as the successful path. Do not assume a code fix repairs existing customer data, or perform bulk repair without a separately justified process.

## Prioritized launch plan

1. **Finish the confirmed repairs.** Verify paired transfers under injected failures, stale refreshes during household switches, allocated transaction edits, and statement selection with more than four accounts. Exercise real UI handlers and persistence contracts. Publish only after independent review and release checks, with a rollback point capturing the previously live state.
2. **Close account, policy and signing prerequisites.** Resolve who operates FlowLedger, the appropriate developer account, approved privacy information and the actual signing identity. These are launch dependencies, not cosmetic work that another web deployment can clear.
3. **Make manual onboarding and imports reassuring.** Keep the existing resumable setup. Add a reviewable import preview, useful validation errors and duplicate explanations before committing imported records. Explain whether a transaction replaces an existing plan or adds a new cash event. Preserve the manual-first release boundary.
4. **Add deliberate, user-controlled automation.** If prioritized after launch gates, build a persisted merchant/category rules manager with visible conditions, precedence, preview, edit/disable and undo behavior. Learned match ranking and an unconnected helper do not satisfy that feature. Require household permissions and regression cases for every automatic financial effect.
5. **Design category rollover separately.** Specify positive balances, overspending, transfers between categories, month close/reopen and interactions with buckets and checking reserves. Test the source calculations before presenting any carried amount. Copying last month's planned assignments remains a different action.
6. **Improve explanation before expanding breadth.** Reports should answer what changed, which obligations caused pressure, and why safe-to-spend differs from the bank balance. Validate those explanations against canonical records. Defer investments, retirement projections, custodial savings and cancellation services until the core product and operational requirements justify them.

## Play Store readiness and January schedule

The native Android readiness check was executed and remains blocked by the missing verified `FLOWLEDGER_PLAY_APP_SIGNING_SHA256`. That is an expected release blocker, not a newly discovered financial bug. Supply the real Play App Signing fingerprint; do not substitute a preview certificate or invent one.

The owner's last confirmed position was that no developer account or registered business had been established. Google's account-type guidance directs financial products/services developers toward organization accounts, but classification of this budgeting-only product must be resolved rather than assumed. Personal accounts created after November 13, 2023 have the conditional requirement of at least 12 opted-in testers for 14 continuous days before applying for production access; that is not a universal rule for every account type.

Before submission, require an approved, truthful public privacy policy and verified operator details. The withdrawn placeholder policy must not be restored. Complete Data Safety, Financial Features, reviewer access and applicable declarations against what the exact candidate actually does. Verify in-app and external account-deletion access.

Produce an exact signed AAB with the real signing identity, then test native libraries/16 KB compatibility, permissions, clean install/reopen, offline/interrupted saves, authentication, household isolation, account deletion and accessibility on devices. Google's current target requirement is API 36 for new phone apps and updates from August 31, 2026; inspect the signed manifest and recheck policy near submission.

The previous release's 1,913 passing tests and Expo Doctor 18/18 are useful historical evidence. They do not prove this new patch set, a signed native candidate, physical-device behavior or store readiness. Use November for prerequisites and reliability work, December for the signed candidate/testing/declarations, and January for submission only if the evidence is complete. Existing [Play readiness](play-store-readiness-audit.md) and [native release](native-release-runbook.md) procedures remain applicable.

## Official references

Competitor references, reviewed October 26, 2026:

- [M1 — Monarch budgeting](https://www.monarch.com/features/budgeting)
- [M2 — Monarch review, splits and rules](https://www.monarch.com/blog/review-on-the-go-and-smart-split)
- [M3 — Monarch tracking, reports and recurring planning](https://www.monarch.com/features/tracking)
- [M4 — Forecasting in Monarch](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch)
- [Y1 — YNAB features](https://www.ynab.com/features)
- [Y2 — YNAB month rollover](https://support.ynab.com/en_us/when-the-month-rolls-over-a-guide-rkyyd6qC9)
- [Y3 — YNAB Together](https://www.ynab.com/features/subscription-sharing)
- [R1 — Rocket Money Premium](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features)
- [R2 — Rocket Money bills and subscriptions](https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions)
- [R3 — Rocket Money account sharing](https://help.rocketmoney.com/en/articles/4562634-account-sharing-in-rocket-money)
- [S1 — Simplifi Spending Plan](https://support.simplifi.quicken.com/en/articles/4212702-understanding-your-spending-plan)
- [S2 — Simplifi Planned Spend rollover](https://support.simplifi.quicken.com/en/articles/9029030-using-rollover-in-the-planned-spend-section-of-your-spending-plan)
- [S3 — Simplifi transaction rules](https://support.simplifi.quicken.com/en/articles/4792733-how-to-use-transaction-rules-in-the-web-app)
- [S4 — Simplifi projected cash flow](https://support.simplifi.quicken.com/en/articles/3357429-using-projected-cash-flow)

Google launch requirements:

- [Target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [Developer account types](https://support.google.com/googleplay/android-developer/answer/13634885)
- [Conditional personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)

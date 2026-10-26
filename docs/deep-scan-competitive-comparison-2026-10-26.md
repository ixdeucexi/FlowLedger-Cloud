# FlowLedger deep scan and competitive comparison

Review date: October 26, 2026. Baseline: `96007c8f414ff22b2e43f5c664bec581bab64676`, the live source at the start of this review.

**Status: four confirmed defects are repaired and independently verified. The database migration is applied and verified; the app release candidate has passed its checks. Live web deployment and postflight are confirmed separately by the coordinating release pass.**

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

The competitor columns summarize documented capabilities; availability can depend on tier. The FlowLedger column describes the baseline inventory; verified repairs are detailed below.

| Area | FlowLedger today | Monarch | Other comparison products | Product implication |
| --- | --- | --- | --- | --- |
| Budget structure | Monthly plan, category assignments and moves; no actual category carryover balance | Flex and Category budgeting, rollover and goals [M1](https://www.monarch.com/features/budgeting) | YNAB assigns available cash and supports category carryover; Simplifi has a Spending Plan and Planned Spend rollover [Y1](https://www.ynab.com/features), [Y2](https://support.ynab.com/en_us/when-the-month-rolls-over-a-guide-rkyyd6qC9), [S1](https://support.simplifi.quicken.com/en/articles/4212702-understanding-your-spending-plan), [S2](https://support.simplifi.quicken.com/en/articles/9029030-using-rollover-in-the-planned-spend-section-of-your-spending-plan) | Design carryover as a financial feature with explicit rules, not a copy button relabel |
| Forecasts and scenarios | Dated cash-flow projections, affordability and debt/simulator strategies | Plus documents cash-flow/net-worth forecasting, scenarios, life events and debt linkage [M4](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch) | Simplifi projects account cash flow [S4](https://support.simplifi.quicken.com/en/articles/3357429-using-projected-cash-flow) | Explain inputs, assumptions and the lowest balance; avoid “only app that forecasts” claims |
| Transaction review | Matching filters, pending review and learned match ranking | Editing, splits, review tools and rules [M2](https://www.monarch.com/blog/review-on-the-go-and-smart-split) | Rocket Money Premium includes manual entries, splits, tags and rules; Simplifi documents transaction rules [R1](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features), [S3](https://support.simplifi.quicken.com/en/articles/4792733-how-to-use-transaction-rules-in-the-web-app) | Improve review clarity and import handling before promising parity with every automation tool |
| User-controlled rules | Generic helper exists; no shipped rules manager | Documented rules [M2](https://www.monarch.com/blog/review-on-the-go-and-smart-split) | Rocket Money Premium and Simplifi document rules [R1](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features), [S3](https://support.simplifi.quicken.com/en/articles/4792733-how-to-use-transaction-rules-in-the-web-app) | A persisted, editable merchant/category rules interface is a real gap |
| Buckets and savings | Spending-bucket lifecycle and purchase history; separate savings goals | Budget rollover and goals [M1](https://www.monarch.com/features/budgeting) | YNAB targets; Simplifi savings/planned-spending tools [Y1](https://www.ynab.com/features), [S1](https://support.simplifi.quicken.com/en/articles/4212702-understanding-your-spending-plan), [S2](https://support.simplifi.quicken.com/en/articles/9029030-using-rollover-in-the-planned-spend-section-of-your-spending-plan) | Make reservations and remaining amounts understandable across the whole plan |
| Debt planning | Snowball/debt strategies, projected payoff and simulator | Debt linkage in Plus forecasting [M4](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch) | YNAB includes a loan planner [Y1](https://www.ynab.com/features) | Demonstrate coherent debt decisions and their cash impact rather than claiming exclusive debt planning |
| Sharing | Household roles, invitations, switching and activity | Separate logins under one subscription, full household visibility and transaction assignment for partner review [M5](https://www.monarch.com/for-couples) | YNAB Together supports six people with sharing history; Rocket Money supports two separate logins [Y1](https://www.ynab.com/features), [Y3](https://www.ynab.com/features/subscription-sharing), [R3](https://help.rocketmoney.com/en/articles/4562634-account-sharing-in-rocket-money) | Retain role and household isolation as explicit acceptance criteria |
| Reporting breadth | Flow, category, debt and goal trends | Reports, recurring list/calendar, net worth and investments [M3](https://www.monarch.com/features/tracking) | Rocket Money Premium includes net worth, export and desktop access [R1](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features) | Explain why the plan changed before taking on a full investment/asset model |
| Bills and subscriptions | Bills, recurring planning and subscription-related review tools | Recurring list/calendar [M3](https://www.monarch.com/features/tracking) | Rocket Money documents bill/subscription management and Premium cancellation assistance/automatic savings [R1](https://help.rocketmoney.com/en/articles/2677184-premium-membership-features), [R2](https://help.rocketmoney.com/en/articles/2185531-managing-your-bills-and-subscriptions) | Do not imply FlowLedger performs cancellation or moves customer money |

Simplifi's distinctions matter: its projected account cash flow excludes Planned Spend and Savings Goals, according to its cash-flow guide. Do not equate a budget's available amount with an account forecast, or suggest every competitor includes every commitment in the same number. Compare concrete scenarios and explain the chosen accounting model.

Numeric prices are intentionally omitted: Monarch Core/Plus feature boundaries and Simplifi promotions make a snapshot price table easy to misrepresent. Verify a specific tier before using a price or feature claim in marketing.

## Confirmed defects and verified repairs

| Priority | Reproduced behavior | Verified repair |
| --- | --- | --- |
| P1 — transfer integrity | Editing a paired transfer from −$100/+$100 to $150 saved −$150, then failed on the second write, leaving +$100: a false −$50 net change | Atomic paired persistence and guards cover create, edit, delete and restore; partial writes fail closed |
| P1 — household state | A delayed debt refresh started in household A published its bills and transactions after the user switched to household B | Scope/generation checks reject stale results; pending debt changes apply once, repeat idempotently and clear correctly when debt linkage is removed |
| P2 — allocated edit consistency | A bank transaction changed from −$100 to −$150 while retaining a $100 review allocation; reports showed $100 while the cash ledger showed $150 | Matched bank amount/date edits require Undo; note edits remain available, and ordinary manual/category edits still work |
| P2 — statement account choice | Statement import offered only `active.slice(0, 4)`; a fifth active account could not be selected. The alert-based choice also had a cross-platform limitation | The account selector reaches every eligible account, including the fifth, with search, cancellation and visible failure/retry behavior |

The first three proofs are recorded in `/tmp/flowledger-deep-sentinel-repros.cjs` and its log, with source paths in `BudgetContext.tsx`, `AddTransactionModal.tsx` and the statement-import handlers in `more.tsx`. These temporary artifacts are investigation evidence, not durable customer records. Financial and import UI repairs passed independent SENTINEL review.

Transfer persistence is atomic, with failure, retry, permission and household-switch checks. Post-sync debt metadata is authoritative. No historical customer-data repair is claimed.

## Verification and release operations

- **Final release gate passed:** `pnpm run verify` exited zero with **1,931 tests**: 217 API, 403 Edge, 37 release fixtures, 1,269 mobile and five serial performance checks. Workspace types, normal web export, artifact/guide/config checks passed. The audit has three high findings, all existing ignored exceptions; no dependency changes or new ignores were added.
- **Independent persistence checks passed:** 43 financial SQL assertions, three concurrency scenarios and 16 additional permission/scope/legacy-client checks, plus 68 bucket/exact/split/Undo compatibility checks. The 66 focused regressions include 16 statement-import and CSV cases; these counts are not an additional aggregate test total. Debt fixtures proved pending 60 → apply → 90 increment → idempotent repeat, and removal of debt linkage restored the expected 1,000 balance.
- **Actual browser flows passed:** eight main routes at phone 390 and desktop 1,200 pixels, with no page errors, external writes or overflow. Both layouts exercised transfer create 75/edit 125/delete; desktop also restored both deleted legs. Editing matched 185 to 190 was visibly blocked with Undo guidance, while note-only edits retained 185. Statement checks covered fifth/first accounts, duplicates, search, cancellation, 503 retry, double tap, role/empty states and Back.
- **Native build checks passed:** Android Hermes export and Expo Doctor 18/18. These are not a signed AAB or device validation.

The applied migration is `20261026185246_atomic_transfers_and_allocated_edit_guards.sql`, SHA-256 `bb18036815a7cd83375ad39fa16551f56194ceec1cb1d7f833f5fb09e91d770e`. Four function privilege/search-path configurations and the enabled trigger were verified; anonymous save/delete/restore were denied without financial row changes. No new security warning appeared; existing informational server-managed RLS notices remain. Authenticated ledger SELECT is a pre-existing July grant protected by member-only RLS: this migration adds no ledger grants. Restricted fixtures verified the private lookup without broadening access. No real customer financial records were read or mutated.

Old sequential transfer clients now fail closed before row writes; refresh the app to use the compatible transfer flow. Rollback must retain the guards/audit and use a compatible client, rather than drop database protections. The remotely verified rollback point is `rollback/prod-before-deep-comparison-20261026-1346`, capturing baseline `96007c8` and deployment `dpl_EdhthKzitm45Fq2KRqWuHAvXVTpP`.

## Prioritized launch plan

1. **Release the verified repairs and monitor them.** Preserve the tested transfer, refresh, allocation and account-selection contracts. Publish with the saved rollback point and complete live postflight before declaring the app release live.
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

The checks above verify this patch set, but do not prove a signed native candidate, physical-device behavior or store readiness. Use November for prerequisites and reliability work, December for the signed candidate/testing/declarations, and January for submission only if the evidence is complete. Existing [Play readiness](play-store-readiness-audit.md) and [native release](native-release-runbook.md) procedures remain applicable.

## Official references

Competitor references, reviewed October 26, 2026:

- [M1 — Monarch budgeting](https://www.monarch.com/features/budgeting)
- [M2 — Monarch review, splits and rules](https://www.monarch.com/blog/review-on-the-go-and-smart-split)
- [M3 — Monarch tracking, reports and recurring planning](https://www.monarch.com/features/tracking)
- [M4 — Forecasting in Monarch](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch)
- [M5 — Monarch for couples](https://www.monarch.com/for-couples)
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

# Flo account-analysis upgrade — September 25, 2026

## Scope and release status

Development work only. The existing server-side OpenAI connection and model configuration are reused. No provider secret is exposed to the client. Production `flo-chat` and the production frontend were not replaced. No customer financial records were changed.

This upgrades grounded conversational account analysis. It does **not** establish that Flo can answer every possible question, and it does not introduce unrestricted model-written financial advice.

## Changes

- Preserve complete calculator answers and useful missing-data explanations instead of truncating responses to 65 words.
- Interpret bounded user and assistant conversation context, including temporary/history-off conversations. Prior answers explain intent; current account reads supply the numbers.
- Use a strict purpose-specific interpretation schema and names-only, household-scoped record catalog. Reject incompatible calculation requests rather than silently changing their scope.
- Read only the sources required by the selected calculators, and recheck actual dependencies for calculations that need a stable snapshot.
- Keep financial arithmetic and factual sentences in application calculators. The optional AI explanation step selects only supported, application-owned insights and follow-ups; its failure cannot discard the calculated answer.
- Repair account-identity matching so absent provider IDs cannot match each other and misclassify manual income as a card refund.
- Preserve checking versus savings scope, named income event dates, relative weekdays, scenario recurrence, historical windows, and requested timeline units.
- Do not infer a complete historical surplus or emergency-fund target when recorded paid bills are missing from classified transaction history.
- Clamp posted budget spending to the current household date rather than labeling future days as observed history.
- Protect privacy preferences during initial loading, household switches, history deletion, and in-flight answers. Cleared conversations are not silently recreated.
- Distinguish current buffer assessment from future funding timelines; distinguish recurring bill-price changes from one-payment changes.
- Label configured debt-plan totals with their scope, and mark an unreconciled all-account debt total partial. Cash balances cannot substitute for debt totals. Exact repeated paragraphs are removed without dropping different amounts or caveats.

The AI SDK and Supabase implementation guidance shaped the bounded model context, server-only provider credentials, strict structured interpretation, and household-scoped reads. Existing calculators and schema were reused; no database migration or new provider connection was required.

## Verification and remaining boundaries

The synthetic evaluation uses fictional balances, bills, transactions and names. It calls the real model through a separate JWT- and secret-protected, expiring evaluation function; the fixture has no database client. Saved receipts include failed intermediate runs so they cannot be mistaken for successful coverage.

Offline evidence collected during this change: 989 mobile tests and five performance checks passed; the mobile web export and full workspace typecheck passed. Backend and live-model final results are recorded below after independent review.

Known boundaries:

- Forecasts cover household checking/cash flow, not future balances allocated to individual savings accounts or a combined all-account total.
- Missing historical debt-principal or savings observations cannot be reconstructed from payment totals or current balances.
- Configured debt-plan balances are not a reconciled total of every connected credit account. Flo states that limitation rather than summing potentially duplicated records.
- Timelines require a contribution amount/frequency or a sufficiently supported historical baseline. A contribution count is not a verified calendar payoff date or proof of affordability.
- Recorded balances are not live bank-funds guarantees. Scheduled income remains expected income.
- The finite question corpus is not universal natural-language coverage. Long calculator responses remain a usability limitation.
- No signed-in browser test against a real customer account was performed in this development verification.

## Final verification

- Final backend suite: **364/364 passed** (`pnpm run test:flo`).
- Final edge typecheck passed (`pnpm dlx deno check --no-lock --sloppy-imports supabase/functions/flo-chat/index.ts`).
- Full workspace typecheck passed; mobile web export passed; 989 mobile tests and five performance checks passed earlier in this change (frontend remained frozen afterward).
- Real-provider synthetic evaluation: the latest full **79-question run was candidate v5**, not the final candidate. It included five conversational follow-ups and exposed remaining interpretation/recurrence issues. Those were repaired and reviewed through subsequent **16-, 8-, and 4-case targeted runs**. The last four-case run verified repeated whole-debt questions, a compound debt-plus-checking question, and an explicitly scoped debt-plan total.
- SENTINEL independently reviewed all 79 v5 answers and all subsequent targeted receipts, plus source and targeted regressions. Final verdict: **PASS for supported-source safety and the observed regression repairs**. No remaining blocking defects were found in that reviewed scope. This is not a universal question-support certification, nor a claim that all 79 were rerun on the final candidate.
- The separate `flo-analysis-eval` function was retired to an inert JWT-protected 404 handler (version 9) at 2026-09-25 15:17 UTC. A request using the former test authorization returned **404 Not found**. It no longer contains model or fixture code. Production `flo-chat` and the production frontend were not deployed by this work.

Receipts: `flo-synthetic-evaluation-20260925-initial.json`, `-second.json`, `-third.json`, `-fourth.json`, `-targeted.json`, `-closeout.json`, and `-debt-guard.json` in this directory. Intermediate failures are retained, not relabeled as passes.

Production release remains separate. Carry these scoped changes onto the current release base so unrelated newer frontend work is not rolled back; save the currently live rollback point before any publication, then verify the authenticated production flow.

# Flo v3 rollout

Flo v3 is intentionally fail-closed. Configure these Edge Function secrets before deploying the function:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FLO_SAFETY_IDENTIFIER_SECRET` (a dedicated high-entropy secret; never reuse a Supabase or OpenAI key)
- `FLO_ALLOWED_ORIGINS` (comma-separated exact origins). Production must include `https://flowledger-algo.com`; add the exact preproduction origin separately for testing. Redirect-only aliases do not need entries. Native requests have no `Origin` and remain supported.

Optional bounded controls are `OPENAI_MODEL` (defaults to `gpt-5-mini`), `FLO_DAILY_REQUEST_LIMIT` (defaults to `100`, bounded to `1..1000`), and `FLO_PRO_ENFORCEMENT_ENABLED`.

Deployment order: set the required secrets and allowed origins, apply `20260812152444_flo_v3_account_intelligence.sql`, deploy the v3 function, then publish the v3 client. Because the current repository replaces `flo-chat` and v3 rejects older requests, there is a coordinated-release compatibility window: old clients receive an upgrade-required response after the function changes. A future rollout should use a separately versioned `flo-chat-v3` function, move clients after health checks, and only then retire legacy `flo-chat`. Do not publish the v3 client before the migration and function are healthy. Roll back by restoring the prior client/function together.

## Financial intelligence layer

The analyst addition preserves the v3 client protocol, authentication, active-household RLS, consent, audit, and confirmed-change workflow. No migration or new provider is required. It is tested on `flo-chat-review` before replacing `flo-chat`; existing v3 clients remain compatible.

- `analysisPlanner.ts` uses the existing model only to interpret dates, filters, and intent into a validated request. Final financial facts and sentences come from deterministic calculators, never model arithmetic.
- `analysisSnapshot.ts` reads explicit, household-scoped columns, with bounded keyset pagination (20,000 records per source). Missing, truncated, or invalid sources are disclosed. Decision-oriented projections are rechecked for concurrent edits. The content hash is an evidence receipt, not an atomic database revision.
- `financialProjection.ts` is the shared pure extraction of the existing mobile forecast. BudgetContext and the Edge adapter use the same recurrence, settlement, pending-match, debt allocation, and daily-balance functions. Historical daily closes remain actual recorded observations, not retroactive forecasts. Existing golden fixtures and startup benchmarks guard parity and startup cost.
- `analysisSchedule.ts` answers scheduled-income and bill-settlement questions without requiring an unrelated balance or APR. Expected income is distinct from income recorded in Activity.
- `analysisSpending.ts` aggregates classified posted transactions, category/merchant totals, comparisons, searches, fee patterns, and unusual-charge review. Identified transfers and card repayments are not consumption; refunds reduce consumption. Invalid splits and ambiguous flows are not invented income.
- `analysisProjection.ts` distinguishes recorded balance, dated scheduled projection, estimated living expenses, and conditional safe-to-spend. Spending decisions require current verified funds and a classified three-month baseline. Future deposits are never labeled available cash today.
- `analysisWealth.ts` and `analysisDebt.ts` cover debt targets, fixed-payment payoff scenarios, verified-limit utilization, savings goals, emergency-fund baselines, and category budgets. Canonical required payments remain on all eligible debts before extra principal rolls forward.
- `analysisStability.ts` covers cash buffers, paycheck commitments, conditional get-ahead plans, observed progress, and immutable cash-flow scenarios. It does not diagnose persistent paycheck dependence from one low balance.

### Deliberate limitations

Forecasts are bounded by the household's configured horizon. A recorded schedule is not proof of a posted payment. Manual debt payments are configured obligations, not independently verified lender minimums. Missing APRs, limits, balances, classifications, or history remain unavailable rather than zero. Fixed-payment debt projections are monthly scenarios, not exact lender quotes or proof that extra payments are affordable. Estimated spending may overlap recurring charges not linked to a bill; that conservative limitation is disclosed. Savings earmarks are not added again to account balances. Historical debt principal and savings progress cannot be inferred from payment totals alone. Merchant patterns are review suggestions, not fraud or duplicate-service determinations. The analyst does not recompute the app's Flow Score.

### Release / rollback

Before this release, `rollback/prod-before-flo-intelligence-20260910` preserves commit `316845dec9c227a5e959b75193eb9b5f8de76b1c` and frontend deployment `dpl_HezsBfNARtjwDYYyuBjH16FVHZZe`. The corresponding production Edge version is `flo-chat` v32, saved separately before any replacement. Package relative dependencies with `scripts/package-flo-edge.mjs`; type-check with Deno and deploy the identical reviewed package with JWT verification enabled. Run authenticated synthetic-account questions, household refusal checks, full release preflight, candidate browser checks, and production postflight. If the release regresses, restore both the prior frontend deployment and the saved v32 Edge package. Never publish a failed independent audit.

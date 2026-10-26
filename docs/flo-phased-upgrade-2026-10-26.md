# Flo phased upgrade tracker

Plan date: October 26, 2026. The owner authorized a phased upgrade, verification before advancing, and publication of each verified phase. Existing configured OpenAI access is reused; the provider and model override remain unchanged.

**Current status: Phase 1 is live. Both production functions match the reviewed candidate and passed access postflight. Phase 2 investigation has started; Phase 3 is planned.**

## Phase gates

| Phase | Intended outcome | Verification required before advancing | Status |
| --- | --- | --- | --- |
| 1 — Account accuracy | Resolve named accounts consistently, preserve ambiguity, and distinguish recorded cash, liabilities and unavailable facts | Source/regression checks; actual configured-model evaluations on fixed fictional records; independent answer review; paired function deployment and postflight | Live; verification passed |
| 2 — Temporary conversation context | Preserve bounded context within a conversation, with fresh financial reads, household/user cleanup, history-off behavior and a clear new-chat reset | Continuation and reset cases; stale-fact rejection; scope changes; limits and history-off checks; independent review; deployment/postflight | Planned |
| 3 — Clearer grounded answers | Explain verified facts more clearly, offer contextual follow-ups and navigate to the relevant source screen | Answer/source agreement; useful follow-ups without invented facts; valid source navigation; regression/independent review; deployment/postflight | Planned |

Each phase must pass its own gate before the next begins. A synthetic evaluation does not substitute for deployment postflight or the later conversation/UI checks. This plan does not promise competitor-wide feature parity or autonomous financial actions.

## Phase 1 changes

- Resolve saved names, connected-provider aliases, punctuation and common abbreviated account references without discarding meaningful digits. Ambiguous names require clarification; a numbered account must not be silently substituted when its number is absent or unsupported.
- Build account inventory from manual records and canonical connected accounts, avoiding duplicate connected/reconnected records. Preserve the distinction between inventory and the sources used for checking/cash or savings planning.
- Keep liabilities separate from cash totals and named debt-plan balances separate from connected credit records. Do not add these sources into a misleading combined balance.
- Describe positive recorded credit liabilities as money owed, zero as no recorded amount owed, and negative connected liability balances as recorded credit/overpayment. An issuer credit is not spendable cash; an unverified negative configured debt-plan balance does not establish issuer credit.
- Report observation dates and missing information truthfully. Missing/future observations, partial source availability and requests for future named-account balances must not become fabricated current balances or default checking answers.

The candidate contains seven shared TypeScript analysis changes plus regression tests and the fixed evaluation corpus. It adds no schema or Plaid functionality and performs no customer financial mutation.

## Verification evidence

The configured-model evaluations used a protected, synthetic-only evaluator and fixed fictional records. They exercised the actual configured model and production analysis path where needed, rather than a full signed-in customer browser session. No real customer records were read or mutated.

| Run | Result | Provider-backed cases | Evidence |
| --- | --- | --- | --- |
| First 32-case run | **31/32 passed**; `natural-ambiguous` failed the clarification-versus-partial-answer check | 9 | [Original receipts](flo-phase1-evaluation-20261026-first.json) |
| Corrected final corpus | **32/32 passed** | 9 | [Final receipts](flo-phase1-evaluation-20261026-final.json) |
| Repeat subset | **8/8 passed** | 6 | [Repeat receipts](flo-phase1-evaluation-20261026-repeat.json) |

The remaining cases used deterministic paths with zero recorded input/output token usage. Numeric token-usage counts are retained as evaluation metadata; receipts contain no authentication tokens, credentials or evaluator package wrapper. The failed first run is retained alongside the successful runs so the evidence does not conceal the initial defect.

SENTINEL independently read all **40 final/repeat answers** and passed the semantic release gate. The first-run failure was addressed before the final and repeat runs; no claim of universal model accuracy follows from this bounded corpus.

Executed checks passed:

- 412 Flo tests, two packaging tests, Deno checks for both function entries and the fixture, and root workspace types.
- 217 API tests, 1,269 mobile tests, five serial performance checks and 37 release-fixture tests.
- SENTINEL's 72 focused checks and additional original adversarial cases.

These are reported check groups, not an additional combined count; packaging or focused checks can overlap broader suites.

## Evaluator retirement and deployment provenance

The first live evaluation used temporary evaluator version 10, which was retired to inert version 11. Final/repeat evaluation used version 12; it was then retired to **inert version 13 with JWT verification enabled**. Five security probes passed. Retirement checks also observed missing-JWT 401 and anonymous-request 404 responses. The evaluator is not a retained public financial-data endpoint.

The frozen candidate packages are:

| Function package | SHA-256 |
| --- | --- |
| `flo-chat` | `abd2d2a47e185cf9d5454aa05b4a3420f0b3697897c4f980c84641e1f6b9e5c3` |
| `flo-chat-v4` | `1d7bb48e5fe52e2e6edf821cae19b13946098648bd45673611ffa04f040616e4` |

The reviewed source was committed and pushed as `b51ce56e5077a12daec01d2adceb6570f3da6015`. Production `flo-chat` version 38 and `flo-chat-v4` version 5 are ACTIVE with JWT verification retained. All 48 runtime files returned for each function exactly match its reviewed candidate; candidate packaging also includes type-only sources omitted from runtime downloads. Their deployment hashes are `fdf9b6e5ce83fd649bdbab20a7e7c7d9251d6dfcbbcfb28f50e4a4fa5db00a98` and `45b0c7dd0f45ce70ac8671a65bc3a4c5eabf02734cc5663dc301f5c546a799c2`, respectively. Both endpoints returned 401 for missing JWT and for a public anonymous JWT. This verifies the access boundary; functional answer evidence is the exact matching synthetic-model evaluation, not a signed-in customer-data session.

The web app remains unchanged at source `12bb`, deployment `dpl_6yWcVNzP7tSAYEh291LQM4pc1CNG`. The immediate pre-production rollback points, pushed and verified after evaluator retirement, are:

- `rollback/prod-before-flo-phase1-release-20261026-2015`, pointing to unchanged web source `12bb` and the deployment above.
- `rollback/flo-functions-before-phase1-release-20261026-2015`, exact Edge package snapshot commit `cd502a8a759af8521364ed8043587565c51c36c3`, retaining the pre-release analysis functions and inert evaluator version 13.

The earlier pre-evaluation points remain available for provenance; the release uses the **2015** references above:

- `rollback/prod-before-flo-phase1-20261026-1941`, pointing to the pre-phase web source `12bb`.
- `rollback/flo-functions-before-phase1-20261026-1941`, exact function JSON snapshot commit `801fdf0a18d2c64572152a37d70feec36124dd5c`, including pre-phase function/evaluator and web metadata.

Rollback must use those exact recorded artifacts. Phase 1 release verification is complete; Phase 2 may now proceed. No frontend deployment or schema change was needed for Phase 1.

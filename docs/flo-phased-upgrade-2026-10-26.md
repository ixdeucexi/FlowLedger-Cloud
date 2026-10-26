# Flo phased upgrade tracker

Plan date: October 26, 2026. The owner authorized a phased upgrade, verification before advancing, and publication of each verified phase. Existing configured OpenAI access is reused; the provider and model override remain unchanged.

**Current status: All three phases are live and verified. Phase 3 passed independent review, paired backend deployment, web deployment and production postflight.**

## Phase gates

| Phase | Intended outcome | Verification required before advancing | Status |
| --- | --- | --- | --- |
| 1 — Account accuracy | Resolve named accounts consistently, preserve ambiguity, and distinguish recorded cash, liabilities and unavailable facts | Source/regression checks; actual configured-model evaluations on fixed fictional records; independent answer review; paired function deployment and postflight | Live; verification passed |
| 2 — Temporary conversation context | Preserve bounded context within a conversation, with fresh financial reads, household/user cleanup, history-off behavior and a clear new-chat reset | Continuation and reset cases; stale-fact rejection; scope changes; limits and history-off checks; independent review; deployment/postflight | Live; verification passed |
| 3 — Clearer grounded answers | Explain verified facts more clearly, offer contextual follow-ups and navigate to the relevant source screen | Answer/source agreement; useful follow-ups without invented facts; valid source navigation; regression/independent review; deployment/postflight | Live; verification passed |

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

For Phase 1 the web app remained at source `12bb`, deployment `dpl_6yWcVNzP7tSAYEh291LQM4pc1CNG`. The immediate pre-production rollback points, pushed and verified after evaluator retirement, were:

- `rollback/prod-before-flo-phase1-release-20261026-2015`, pointing to unchanged web source `12bb` and the deployment above.
- `rollback/flo-functions-before-phase1-release-20261026-2015`, exact Edge package snapshot commit `cd502a8a759af8521364ed8043587565c51c36c3`, retaining the pre-release analysis functions and inert evaluator version 13.

The earlier pre-evaluation points remain available for provenance; the release uses the **2015** references above:

- `rollback/prod-before-flo-phase1-20261026-1941`, pointing to the pre-phase web source `12bb`.
- `rollback/flo-functions-before-phase1-20261026-1941`, exact function JSON snapshot commit `801fdf0a18d2c64572152a37d70feec36124dd5c`, including pre-phase function/evaluator and web metadata.

Rollback must use those exact recorded artifacts. Phase 1 release verification is complete; Phase 2 may now proceed. No frontend deployment or schema change was needed for Phase 1.

## Phase 2 — Bounded temporary context

**Live and verified.** SENTINEL approved the source, all 72 final/repeat semantic answers, and the browser evidence. The backend was deployed before the compatible new web client.

Temporary context is limited to **12 turns, 2,000 characters per turn and 24,000 UTF-8 bytes**. It does not create saved conversation history. Only eligible, successfully completed turns can contribute context. Failed or stopped turns form a barrier for new questions; retries exclude the failed turn IDs so eligible earlier context can still be used.

Explicit account names, meaningful digits and account-group requests override inferred references. References derive from prior **user** provenance and resolve against a fresh financial snapshot; assistant-written amounts never become financial facts. Supported pronouns use a closed interpretation path, acknowledgements are skipped, and complex unresolved references request clarification. This is bounded context, not unrestricted memory.

The frontend includes New chat, Stop, interrupted-stream handling and guards against late responses after a reset or identity change. User changes and same-user household changes clear the relevant context, including A → B → A. History-off behavior remains part of the acceptance criteria. No schema, new Plaid capability or autonomous money action was introduced.

### Phase 2 evaluation and browser evidence

| Run | Coverage and result | Actual provider use | Evidence |
| --- | --- | --- | --- |
| Final | **44 cases / 56 answers passed:** 32 Phase 1 single-turn cases and 12 two-turn context sequences | Nine natural-language cases in the retained single-turn corpus; closed context sequences used deterministic paths with zero recorded provider tokens | [Final receipts](flo-phase2-evaluation-20261026-final.json) |
| Repeat | **Eight sequences / 16 answers passed** | Zero recorded provider tokens | [Repeat receipts](flo-phase2-evaluation-20261026-repeat.json) |

SENTINEL independently reviewed all **72 answers**. The existing configured model was exercised by the natural-language single-turn cases; the closed follow-up arithmetic paths are deterministic by design. These fixed fictional evaluations do not establish a complete real-customer end-to-end session. The copied receipts contain answer/source/usage evidence, with no credentials or evaluator wrapper.

Actual exported UI checks at **390 and 1,200 pixels** used mocked authenticated SSE and loopback traffic: **44 mocked POSTs** across the scenarios. They covered successful context, failed/stopped barriers, retry, partial SSE, keyboard New chat, late old streams, user changes and same-user household A → B → A. Consent “Not now” produced zero POSTs; the preview produced zero history writes. Unknown external requests, console errors and horizontal overflow were zero. Raw browser headers, bearer/session material and local TLS files are not copied into this report or its evidence files. The tested exported entry's SHA-256 is `601412c5133a63c9170952fbb14f7e793880054bedf6e82840b61c48462a8816`.

Executed checks passed: **428 Flo tests; 1,272 mobile tests; five serial performance checks; mobile and all workspace types; web export; Deno checks for both function entries and the fixture; two packaging tests; 217 API tests; and 37 release fixtures.** SENTINEL also passed 109 focused checks and seven adversarial pipeline probes. These overlapping check groups must not be added into a new total.

### Phase 2 provenance and retirement

| Frozen function package | SHA-256 |
| --- | --- |
| `flo-chat` | `c2f066e406f39bf96240bafbd7e5e914fb2cbf3010bc5093f207b76b3b946ebd` |
| `flo-chat-v4` | `c4754a1e2561938e66ef7bcc2545de44ef06ba4ba65cfc1d43eb0d07cc8a9883` |

The temporary evaluator used version 14; all 50 runtime files passed candidate parity and five security probes passed. It was retired to **exact inert version 15 with JWT verification enabled**. Retirement checks observed missing-JWT 401 and anonymous-request 404 responses.

The pre-test rollback points are `rollback/prod-before-flo-phase2-20261026-2019` for web source `12bb` / deployment `dpl_6yWcVNzP7tSAYEh291LQM4pc1CNG`, and `rollback/flo-functions-before-phase2-20261026-2019`, snapshot commit `ab8bb1f8f8180ddb10174bfd9679c65b6881d4ae`, for the prior functions and inert evaluator 13. The fresh immediate pre-production points are `rollback/prod-before-flo-phase2-release-20261026-2044` for that same live web artifact and `rollback/flo-functions-before-phase2-release-20261026-2044`, snapshot commit `1e107fbc509981473fa061e096691f1e519cae45`, retaining Flo 38, v4 5 and exact inert evaluator 15. Deployed Phase 2 versions and postflight evidence are recorded below.

Phase 2's backend context parameter is optional. Production `flo-chat` version 39 (`30b093ace8f8fb89142a46e5e7c39a97dba0523b098a35c395bd81d7d72c193a`) and `flo-chat-v4` version 6 (`5c9fa69a9188df944e756e40ff01e28d172f960a96f290537665a5daf17c1277`) are ACTIVE with JWT verification retained. All 48 runtime files returned for each exactly match its reviewed candidate. Both functions passed missing-JWT and public-anonymous-JWT 401 checks.

Web source `0cd70ed4f39e381344b831f111c5fc338da93a4a` is READY in production deployment `dpl_DZ8Lyvp2LKGU2wBAqEM71sAeN5Yp` (`flow-ledger-cloud-bxisql1tr-flow-ledger-s-projects.vercel.app`). The canonical domain, www, project Vercel domain and legacy team domain were each inspected and resolve to this same source/deployment. The legacy team alias was explicitly moved after readiness. Production postflight passed registered routes, clean startup HTML, immutable hashed JavaScript, release UI signatures, no-store worker and guide PDF parity, health and missing-resource behavior. Public login browser checks passed at 390/1200 with no writes, overflow or page errors. These public checks do not claim an authenticated customer-data session.

All 18 Expo Doctor checks passed after using the environment's configured network proxy; dependency audit passed with the same three existing ignored high advisories and no dependency or ignore changes. The only runtime stderr entry in the release window was the pre-existing Node `DEP0169` warning from the successful health check; this is not a claim of zero log entries. Phase 2 release verification is complete and Phase 3 may proceed.

## Phase 3 — Grounded detail, follow-ups and temporary session continuity

**Live and verified.** Backend/privacy, navigation/retention, main/negative browser checks and production postflight passed. The release adds clearer bucket detail, typed follow-up chips and source navigation. Suggestions ask a grounded question or open an allowed app destination; they do not autonomously move money. Connected-account destinations remain read-only.

Bucket answers use canonical amounts rather than inventing totals from an incomplete history. The fictional reference bucket has **500 planned, 125 recorded spent and 375 remaining**; split-purchase history shows **30 assigned to this bucket from a full 100 bank transaction**. The full transaction amount is not treated as the bucket allocation. The evaluation covers purchase history, closed/overspent states, pending/removed activity, invalid allocations, ambiguous names, missing sources and date/year/period scoping. Account and credit follow-ups retain the earlier phases' separation of cash, liabilities and credit.

The Root session provider retains only volatile conversation state across ordinary app navigation, capped at **60 messages and 256,000 bytes**. This UI retention cap is distinct from Phase 2's smaller request-context limits. Scope, epoch and owner leases prevent stale screens or async completions from publishing into a different session. New chat, logout, user, household, budget and role changes clear the session. This is not permanent memory, saved-history expansion or permission to reuse old assistant amounts as facts. No customer financial-data evaluation or new Plaid capability is introduced.

### Phase 3 evidence

| Run | Passed coverage | Actual provider use | Evidence |
| --- | --- | --- | --- |
| Combined final | **66 cases / 78 answers**, including **22 new Phase 3 cases** and the retained earlier-phase corpus | 10 provider-backed answers; remaining paths deterministic/static | [Final receipts](flo-phase3-evaluation-20261026-final.json) |
| Repeat | **10 requests / 12 answers** | One provider-backed answer; remaining paths deterministic/static | [Repeat receipts](flo-phase3-evaluation-20261026-repeat.json) |

All **90 backend answers** passed the independent answer gate. Provider-backed cases exercised the existing configured model; the other answers are not represented as additional model calls. The sanitized receipts contain fixed fictional questions, records, answers, sources and numeric usage metadata, with no bearer credentials, sessions or evaluator wrapper. This evidence is not a signed-in real-customer end-to-end session or proof of unrestricted conversational accuracy.

Source/privacy review passed. Executed checks passed: **455 Flo tests, 1,283 mobile tests, five serial performance checks, 42 volatile-session focused checks, 91 backend focused checks and nine privacy focused checks**; Deno checks, packaging and web export also passed. All workspace types, **217 API tests**, **37 release-fixture tests**, Expo Doctor **18/18**, mobile configuration, guide and artifact checks passed. The dependency audit retains the same three existing ignored high findings; the lockfile and ignore policy are unchanged. Check groups can overlap and are not an additional combined total.

The initial browser run exposed an off-route Settings history handler writing an empty section onto Flo; repeated account-source navigation could show Settings overview instead of account records. A bounded More route-ownership helper now fixes that defect. The repair passed **43 targeted checks and 25 independent SENTINEL checks**. The actual 1,200-pixel partial-source scenario passed three accounts ↔ `/flo` cycles without empty-section pollution.

The final retention receipt independently passed at **390 and 1,200 pixels** against exported entry `entry-be485a94e4cd39b66062a21485565db8.js`, SHA-256 `a499da404cb689740b5bddb555d127f07ccead589e4aa7f01189d417aa19c4c8`. Returning from a source preserved the answer, sources, chips, caveat and prior successful pair. New chat cleared context; partial/interrupted streams stayed excluded, and late old streams could not clear the new conversation. Away-screen household/user A → B → A changes cleared context. Desktop actual sign-out while away followed by sign-in as A, without a reload, also returned with empty context. No page/console errors, transcript browser storage or history writes were recorded. Browser evidence remains local/mock-backed and contains no real customer financial data.

The final main browser matrix passed at 390/1,200 pixels with **32 v4 POST requests**, against the same exported entry/hash above. Normal flows recorded zero console/page errors, overflow, history writes or unhandled non-local traffic. The connected-account negative case passed: held loading and an injected 500 hid the prior record; Retry showed fictional Beta 333; returning to Alpha showed 700. An unavailable balance was not displayed as zero. This injected-failure case recorded **one expected 500 resource-console entry and zero page errors**; it is not reported as a zero-console run. All browsers and test servers were closed, with no listeners remaining on ports 8126/8127.

SENTINEL independently approved the whole Phase 3 production release after reviewing the final browser evidence, privacy boundaries and all 90 answers. Deployment and live postflight subsequently passed as recorded below. The local browser fixtures and synthetic evaluations remain distinct from the public production checks; no authenticated real-customer financial session is claimed.

### Phase 3 rollback provenance

The following frozen backend packages passed review and exactly match all returned production runtime source files:

| Function package | SHA-256 |
| --- | --- |
| `flo-chat` | `655225a64d49b85bf80a521ccdfaa4c870efaf77ae272bf476e5e3986fe9e24f` |
| `flo-chat-v4` | `c98cddabb9c7861b6834874e5f2f742b1cfcbc6bb5adf12df0edd97d9712b957` |

The protected synthetic evaluator used version 16 with 55 runtime files matching the reviewed package. Five security probes passed. It was retired to exact inert version **17**, retaining JWT verification; missing-JWT requests returned 401 and a valid public anonymous JWT returned 404. The evaluator source is only a static Not found response. No customer data client was constructed for the evaluation.

Fresh pre-production rollback points were pushed and remotely verified:

- `rollback/prod-before-flo-phase3-release-20261026-2204` captures source `0cd70ed4f39e381344b831f111c5fc338da93a4a`, production deployment `dpl_DZ8Lyvp2LKGU2wBAqEM71sAeN5Yp`.
- `rollback/flo-functions-before-phase3-release-20261026-2204` captures exact prior function/evaluator source at snapshot commit `06daf56a288905a58b8f34eda96f19c60b673f98`: `flo-chat` 39, `flo-chat-v4` 6 and inert evaluator 17.

Earlier phase provenance above remains historical and unchanged. A rollback must restore both the recorded web artifact and the paired function snapshot.

### Phase 3 production release and postflight

Reviewed source `02179cb548f6066de75c5d22803c7794d6e852df` was committed, pushed and checked clean before deployment. The backend was deployed first:

| Function | Active version | JWT verification | Returned runtime files matching the reviewed candidate | Deployment SHA-256 |
| --- | --- | --- | --- | --- |
| `flo-chat` | 40 | Enabled | 51/51 | `025f05e133dbb1d6af6876687ef5fa6c12992d8b4d92ba6a0871f85ebe4b00de` |
| `flo-chat-v4` | 7 | Enabled | 51/51 | `5b026bfa6684cb217a42de342c3a5c9778280ce4f7c4bf71c88447e2a9d39e04` |

Both endpoints returned 401 for missing JWT and for a public anonymous JWT. These access checks do not constitute a customer-data answer session. Evaluator version 17 remained inert, with missing-JWT 401 and valid public-anonymous-JWT 404 reconfirmed after release.

The exact source is READY in production deployment `dpl_HAvp3QGcJXZXs9eDaonkiSkdgm95`, immutable URL `flow-ledger-cloud-mctwgja77-flow-ledger-s-projects.vercel.app`. The canonical domain, www, project Vercel domain and legacy team domain were independently inspected after readiness and all resolve to this same production source/deployment. The legacy team alias was explicitly moved after readiness. All 13 required environment names and all 14 configured records passed the Production-only metadata scope check without inspecting plaintext credentials; canonical project/team identity and Node 24 were verified.

Production postflight passed clean-source provenance, registered app routes, startup HTML with no-store caching, executable immutable hashed JavaScript, prior release signatures plus connected-balance/chat copy, health 200, missing API/asset 404, exact no-store service worker and guide-PDF parity. Read-only public login browser checks passed at 390/1,200 pixels with zero writes, page errors or horizontal overflow. Runtime inspection found one stderr entry: the pre-existing Node `DEP0169` `url.parse()` deprecation warning from the successful health check. No new application failure was observed; this is not a claim of zero log entries.

Phase 3 release verification is complete. This report's postflight update is documentation only; the deployed application source remains the exact reviewed commit above.

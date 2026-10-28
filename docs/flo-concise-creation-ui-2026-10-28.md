# Flo concise answers, creation and chat UI

Date: October 28, 2026. The owner requested clearer, shorter answers and reliable creation through Flo. Standing authorization covers publication after verification.

Status: candidate verification and the applied production migration are recorded below. Backend deployment, web deployment and postflight remain pending. This document does not claim the candidate is live.

## Changes

- Flo leads with a concise answer. Supporting sources and details remain available without repeating the full analysis in the conversation.
- Missing historical coverage no longer blocks self-contained current balances or recorded schedule totals. Flo states the applicable date window and limitations. It still refuses to invent a safe spending allocation or recommendation when the supporting baseline is missing.
- Opening Flo or receiving prefilled text does not submit a question automatically. Submission requires Send. Cancel clears a pending draft. Stopping after a save has been submitted may still finish that save; Flo explains this and keeps its receipt/retry bound to the original operation.
- The chat UI has clearer conversation hierarchy, restrained supporting details, visible creation progress and recoverable failures. Long transaction descriptions remain intact in the command while their displayed receipt titles are bounded.
- A closed registry supports creating a bill, debt, income, manual transaction, spending bucket or savings goal. Ordinary bills may explicitly be one-time. Missing fields are requested rather than guessed; ambiguous dates, negative amounts and unsupported recurrence must not be silently substituted. Unsupported actions receive a clear unable response; the existing reviewed recurring-bill editing path is preserved. Flo must not claim an item was saved without a verified receipt.

Creation follows the app's applicable canonical safety previews. The authenticated client commits through `create_flo_entity(command_id, kind, payload, expected_household_id, expected_budget_id)`. The server derives actor, active household and default budget, rechecks current edit access, validates strict fields/dates/money/recurrence and checks account scope. A changed preview budget rejects the command.

Entity insertion and an immutable receipt are atomic. Actor/household/command identity, the recorded preview budget and canonical payload hash bind retries. Exact and concurrent retries produce one entity; changed payloads or budget reuse reject. Retrying does not overwrite an edited entity or resurrect a deleted one. History recovery uses a scoped read-only receipt RPC rather than executing an old proposal. Receipts have no conversation/history dependency; account and household deletion clean them up through lifecycle cascades.

## Verification

Recorded candidate gates:

- Mobile: 1,361 tests in 14 suites plus five separate performance checks passed (`/tmp/flo-refresh-mobile-full.log`).
- API: 217 passed; edge: 539 passed (`/tmp/flo-refresh-api.log`, `/tmp/flo-refresh-edge-full.log`).
- Workspace/mobile and edge typechecks passed (`/tmp/flo-refresh-workspace-types.log`, `/tmp/flo-refresh-edge-types.log`). Earlier failed checks are not counted as passing runs.
- Release fixtures: 37 passed. Mobile configuration, current user-guide PDF and web export passed; Expo Doctor passed 18/18 (`/tmp/flo-refresh-release-fixtures.log`, `/tmp/flo-refresh-config.log`, `/tmp/flo-refresh-guide.log`, `/tmp/flo-refresh-export.log`, `/tmp/flo-refresh-doctor.log`).
- Actual isolated PostgreSQL 17: 169 assertions passed, independently rerun by SENTINEL. Coverage includes all six kinds, explicit one-time bills, exact/concurrent/altered retries, viewer/revoked access, household/account/budget scope, changed defaults, dates/precision, rollback, edited/deleted entities, receipt recovery and lifecycle cleanup. Command: `node scripts/test-flo-creation.cjs`.
- Real-model-to-PostgreSQL bridge: seven unchanged provider-derived READY payloads across all six kinds plus a one-time bill created seven correctly typed records; seven exact retries created no duplicates. Eighty additional assertions passed. Only opaque household/budget/account fixture IDs were remapped. Command: `node scripts/test-flo-creation.cjs --model-receipts /tmp/flo-refresh-eval/receipts-round2.json`; evidence: `/tmp/flo-creation-model-postgres-bridge.json`.

### Browser evidence and limits

The earlier 16-case full matrix covered v3 history on/off and admin v4 at widths 320, 390 and 1,200. Its frozen entry was `entry-e59a8ed15bf0847608429dd78d03a127.js`, SHA-256 `43f39036a8e0201bda866cf46755871c58a7addeaf12fb8617a20b591ba9f66e` (`/tmp/flo-refresh-browser-summary.json`).

The latest six focused cases passed on `entry-3f13f477c91c983cf14cd28d38d11f4d.js`, SHA-256 `b1732628dffd92e751996c497ea2aa5bf5a7eba12f4244fe27d1c7fda285483d`. They checked blank/settled layouts at those three widths, income clarification through Saved/Open, long-note preservation with exact retry, and cancellation/stopping. One deliberate RPC 500 tested recovery; normal page/console errors were zero (`/tmp/flo-refresh-final-smoke-summary.json`).

These browser runs used fictional records, intercepted model responses and mocked creation/receipt RPCs. They are functional UI evidence, not live-model or production-write evidence. The budget/demo/ABA scope cross-product has actual-effect/PostgreSQL coverage and is not represented as complete browser coverage. No customer records were changed; test browsers and loopback servers were closed.

### Real-model evaluation

Run 1 failed: 20 of 32 automated cases passed. Its immutable receipts remain at `/tmp/flo-refresh-eval/receipts-run1-failed.json`. Creation extraction, negative-amount handling, one-time bills and concise/factual responses exposed problems that were addressed before rerunning.

Round 2: 39 of 40 automated cases passed. Preserve that result unchanged. The remaining generic income question returned $3,000 for the explicitly disclosed September 10–30 window: two scheduled $1,500 payments. Its fixture expected one payment. A separate semantic review documents why the answer is correct for the stated window; it does not rewrite the failed automated check or approve production (`/tmp/flo-refresh-eval/receipts-round2.json`, `/tmp/flo-refresh-eval/semantic-review-round2-fixture-window.json`).

Round 3: all five cases across seven turns passed. Security gates passed; the temporary evaluation endpoint was restored to its inert 401/404 state. The release coordinator confirmed these results; original receipts remain at `/tmp/flo-refresh-eval/receipts-round3.json`. SENTINEL returned final whole-change PASS.

## Rollback

- Web tag: `rollback/prod-before-flo-refresh-20261028-1422`, source `93143d52f10d5cdec95f5ff6d8de5e8f492a953e`, previous READY deployment `dpl_6w95qHbXTPZQz4u3D4jBHff6AYCD`.
- Backend tag: `checkpoint/flo-functions-before-refresh-20261028-1422`, checkpoint commit `45ac2079f9e1a1a03853e24c9d9caae90576d5af`.
- Exact deployed source snapshots: `docs/release-snapshots/flo-before-refresh-20261028-1422/`. Manifest records `flo-chat` v40, SHA-256 `025f05e133dbb1d6af6876687ef5fa6c12992d8b4d92ba6a0871f85ebe4b00de`, and `flo-chat-v4` v7, SHA-256 `5b026bfa6684cb217a42de342c3a5c9778280ce4f7c4bf71c88447e2a9d39e04`; both verify JWTs.

The creation migration is additive. If rollback is needed, restore clients/functions before restricting the unused new RPC; do not delete created financial entities or command receipts as a rollback shortcut.

## Production release record

- Reviewed source commit: **pending**.
- Production migration: applied as `20261028155138_create_flo_entity.sql`; SQL SHA-256 `c4982b5e8955ea5f6a55cad135d61554a1d4f978c3037fb62551a05dfca079ef`. Hosted metadata confirms the five-argument creation RPC and three-argument reader, public invoker/private definer boundaries, empty search paths and authenticated-only execution. The private ledger has RLS enabled and postgres-only direct ACLs. Advisors returned zero WARN/ERROR findings; the intended private no-policy ledger adds one INFO entry (12 to 13 such tables).
- Deployed backend versions and exact source verification: **pending**.
- Web deployment, immutable URL and alias/source parity: **pending**.
- Production HTTP, schema/grants and signed-out browser postflight: **pending**. Creation evidence combines real-model fictional payloads, actual local PostgreSQL writes and intercepted authenticated UI flows; it does not claim customer-record production writes.
- Final release recommendation and remaining limitations: **pending coordinator entry**.

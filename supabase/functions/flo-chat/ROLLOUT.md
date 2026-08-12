# Flo v3 rollout

Flo v3 is intentionally fail-closed. Configure these Edge Function secrets before deploying the function:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FLO_SAFETY_IDENTIFIER_SECRET` (a dedicated high-entropy secret; never reuse a Supabase or OpenAI key)
- `FLO_ALLOWED_ORIGINS` (comma-separated exact origins). Production must include `https://flowledger-algo.com`; add the exact preproduction origin separately for testing. Redirect-only aliases do not need entries. Native requests have no `Origin` and remain supported.

Optional bounded controls are `OPENAI_MODEL` (defaults to `gpt-5-mini`), `FLO_DAILY_REQUEST_LIMIT` (defaults to `100`, bounded to `1..1000`), and `FLO_PRO_ENFORCEMENT_ENABLED`.

Deployment order: set the required secrets and allowed origins, apply `20260812152444_flo_v3_account_intelligence.sql`, deploy the v3 function, then publish the v3 client. Because the current repository replaces `flo-chat` and v3 rejects older requests, there is a coordinated-release compatibility window: old clients receive an upgrade-required response after the function changes. A future rollout should use a separately versioned `flo-chat-v3` function, move clients after health checks, and only then retire legacy `flo-chat`. Do not publish the v3 client before the migration and function are healthy. Roll back by restoring the prior client/function together.

Canonical Forecast, Flow Score, Safe Cushion, and payoff recomputation are not exposed by this Edge Function. The existing canonical calculation entry point is `buildDashboardFinancialModel`, which depends on the app-built forecast closures (`getDailyBalances`, monthly bill/income settlement state, pending-match state, and device-local time inputs) plus `buildAlgorithmSuite`. Moving only the final algorithm function server-side would omit the canonical forecast construction and produce calculation drift. A safe follow-up must extract the complete financial-model input builder and its pure dependencies into a shared workspace package, run the existing mobile fixtures unchanged against both mobile and server adapters, and only then add a Flo tool. Until that parity work exists, Flo returns unavailable/partial instead of recomputing or guessing.

# Bills, debt sizing, and pause confirmation — November 3, 2026

Release source: `f16e3167b1b3d6347d1524502d8b225fbfec6ba9`.
Production deployment: `dpl_EiD4GAMRw4ChFPyfY9y4NnQtFjyd`.
Immutable URL: `flow-ledger-cloud-nvx6j9ror-flow-ledger-s-projects.vercel.app`.
Release status: **LIVE — production postflight and hosted verification passed.**

## Result

Fixed column minimum widths were forcing mobile Bills and Debt amounts below their names into awkward blocks. Both lists now use compact, flexible headers with right-aligned full USD amounts and cents. Metadata and debt payment details use the available width below the header. Names get enough room before a large amount wraps onto its own right-aligned line. Status badges, rank, dates, and privacy masking remain available.

Pausing now has two steps: choose dates, then explicitly answer **“Would you like to move this payment to another debt?”** Neither choice is selected automatically. **Yes, use payoff order** uses the existing temporary redirect behavior; **No, keep it available** saves a pause without redirecting the cash. Redirecting requires Debt Payoff Plan to be enabled. One existing pause update is saved after the final choice.

Back returns from the question to the dates without losing the draft. Calendar Back, cancellation, rejected-save retry, duplicate-submit protection, pending-save Back, household access, and reopening behavior are preserved. Web radios expose selected state to assistive technology and support Space and Enter; native controls retain their native accessibility state.

Paused cards keep their rank and say **“Payments paused — keeps its payoff position.”** Only the currently eligible target with Debt Payoff Plan enabled says **“Current payoff target.”** Other eligible cards say **“Follows your saved payoff order.”** The saved debt order, amounts, and financial calculations are unchanged.

## Verification

- The functional implementation passed 1,650 mobile tests, five performance checks, 37 release fixtures, and mobile typecheck. After the final guidance-only corrections, all 19 affected UI tests and mobile typecheck passed again. Independent review added five state probes and five footer-state cases; source and local runtime review passed.
- The comprehensive browser baseline at `bb22553215a428e17a0f4a2ee54c8b2eea7e2d93` passed four layout and three behavior contexts. Ten layout states cover 320/390-pixel mobile, 1,200-pixel desktop, light/dark themes, long names, full large amounts, and actual 125% text enlargement. The flow cases cover Yes, No, plan-off, keyboard, retry, reload, cancellation, and pending Back.
- After guidance-only changes, a bounded final browser flow ran on the exact shipping source and asset. It confirms paused rank #1 and current target #2 messages, full currency, explicit keyboard Yes, rejected-save retry, reload, original debt rank/minimum/balance, and coherent planner/Forecast/Dashboard totals. Earlier comprehensive cases are recorded against their actual baseline, rather than claimed against the final hash.
- The final source is clean in a dedicated release worktree. All 45 exported files match the tested export byte for byte. Mobile configuration, guide drift, artifact copy scanning, whitespace, remote annotated rollback, Production-only credential scope, and canonical project identity checks passed.
- The exact shipping flow passed again on the live site, including retry, reload, both debt-card messages, full amounts, rank, keyboard selection, and coherent planner/Forecast/Dashboard values. All four production aliases resolve to the same READY source. Actual HTTP checks passed for app routes, startup, health, missing resources, cache headers, service worker, guide PDF, and the exact tested JavaScript hash.

Shipping entry: `/_expo/static/js/web/entry-98f2b48574f5132ab2bc6038556fa96c.js`.
Bytes: `5208317`.
SHA256: `2ea69bc18715cc6695591b393f8709f919cdf776677a4aa97c1b63220eee5930`.

Browser saves use fictional in-memory pause-only CAS updates. No customer financial records or model/provider calls were made. The database, Edge Functions, authentication, and financial engine were not changed by this release. The public guide and PDF describe the updated pause flow.

The deployment request supplies the canonical Node 24, pnpm install, Expo web export, and `artifacts/mobile/dist` build contract explicitly. Authenticated project metadata does not expose all build defaults. Release scripts substitute fresh authenticated MCP deployment inspection for CLI inspection only; remote Git verification and actual HTTP checks remain intact.

## Rollback and evidence

Verified remote annotated rollback tag: **`rollback/prod-before-debt-pause-layout-20261103-1440`**.
Created before this release changed production, it captures source `d8212d1de5815e03885d61ac5d7b1a40239d8a09` and deployment `dpl_H2Yh5qTcVq7PTHvemHc8RB72UmXY`. Restore that deployment and verify all four production aliases together if needed. Existing saved pause history and backend services remain compatible.

Sanitized evidence: `/workspace/artifacts/qa-debt-pause-refine-20261103/`. Browser functional/copy baselines identify their actual source and asset; final local/production receipts identify the shipping asset. Source hashes, review results, tests, guide preview, alias/HTTP proofs, cleanup, sanitization, and artifact hashes are retained. Raw fixtures, credentials, authentication/storage state, and runtime configuration are excluded. The unrelated untracked marketing directory was left untouched.

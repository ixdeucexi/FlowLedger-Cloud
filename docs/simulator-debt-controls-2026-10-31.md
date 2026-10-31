# Simulator debt controls

The owner requested regular debt payment changes, a temporary payment pause with a payoff-date warning, and hypothetical new debts. Standing authorization covers publication after verification.

Release status: live and verified. Source, financial review, local browser and production postflight gates passed.

## Behavior

- Forecast → Simulator → Debt includes Change debt payment, Pause a debt and Add a debt alongside the existing extra-payment and payoff options. Existing desktop debt-selection arrows remain available.
- A payment change sets the full regular amount for each scheduled occurrence from the selected date. Existing extra-payment plans remain separate. Recorded and pending payments retain their original amounts.
- A pause has a start and resume date. Interest continues, the debt remains in the payoff calculation, and the editor warns that repayment may take longer. A pause excludes automatic extra payments during its window. The resume date is exclusive: payments can resume on that date.
- A hypothetical debt accepts its name, balance, APR, regular payment, frequency and first-payment date. Adding it creates no checking deposit and writes no real debt record. It can be selected for further scenario changes.
- Users can edit, remove, save and compare the new changes through the existing scenario library. Free retains its current working draft; existing named-save and comparison permissions continue to apply.
- A payment that cannot clear the debt within the 30-year projection shows that limit. Missing references or incomplete inputs show an unavailable payoff estimate.

## Financial integration

New debt controls reuse the dated monthly snowball engine for interest, payoff caps, ordering and rollover. Optional engine inputs support scenario-only pauses and dated payments; existing real Forecast callers keep their original defaults. Current and saved comparisons use a shared calculation mode and horizon.

Per-occurrence source references preserve the original amount, actual settled portion and immutable pending commitments. Original carried-payment dates remain distinct from their visible cash dates. Existing saved extra-payment amounts retain their scheduled dates and are counted once. Historical principal already absorbed before the visible cash anchor remains fixed when changing future payments.

The saved scenario format remains version 1 with additive change kinds. No database migration, auth/RLS changes, provider deployment or customer financial writes are required. The in-app guide and exported PDF describe the new options.

## Verification and release

Application source is committed as `513a26071133a0379c213dd8809d13c1488d3254`. The independent financial/source review passed with zero blockers. Twenty verification groups include 480 unchanged default snowball comparisons, 222 unchanged canonical Forecast months, 361 real-source dated cases, 80 historical-principal/cash conservation cases, pending and partial-payment protections, 48 independently calculated interest cases, and saved-payment date/JSON/comparison checks.

The full mobile suite passed 1,560 tests and five performance checks. Mobile TypeScript, 37 release fixtures, mobile configuration, guide freshness, exported artifact copy and clean-source checks passed. The final export is `entry-c88c1c08ba25d59ba286e7a9331b9c79.js`, SHA-256 `27cd0fbcba287d8edc0eec351fae12820b442c950dd3062237f3d88d553a959d`. The primary checkout generated the export; the clean release checkout contains an identical 45-file artifact inventory. A symlinked-dependency worktree export could not resolve Metro's outside-root modules; no dependency installation or product change was needed.

Final browser clearance passed in 13 contexts, with 26 actual entry loads matching the approved bytes. Phone and desktop journeys cover the three controls, existing debt-selection arrows, save/reload/edit/remove/reset, shared saved comparisons, 30-year and unavailable labels, Free/Founder permissions, Privacy, both themes and 320-pixel layouts. The actual-source Small/Large fixture preserves identical results for an unchanged payment. There were no unexpected requests, app errors, provider calls or actual financial writes; financial snapshots remained unchanged. All local runners closed. Earlier candidate runs remain diagnostic only.

Browser fixtures use fictional data and intercepted scenario saves. Archived proof removes auth/session/header and raw storage values. Eight selected screenshots accompany the sanitized aggregate and compressed details.

Read-only release inspection confirmed the canonical team/project, Node 24, Production-only environment metadata, and all four existing production aliases. The MCP project response omits build/install/output/root settings, so those fields cannot be asserted from that response. The production deployment request explicitly supplied the repository's build contract.

Deployment `dpl_7sMtM5zxUFvf5HgZGubmb6JBYBxi` is READY at `flow-ledger-cloud-6e8cmn8h1-flow-ledger-s-projects.vercel.app`, built from the approved source. Canonical, www, project and legacy team addresses all resolve to it; the legacy team alias was moved after readiness. The actual HTTP postflight passed source/alias provenance, exact approved entry bytes, registered SPA routes, cache headers, health, missing-resource behavior and service-worker/PDF parity. Authenticated MCP inspection data substituted for unavailable local Vercel CLI reads; the repository's HTTP assertions remained intact.

The same five browser verification groups passed against real deployed assets on the canonical production origin. This runtime replay used the identical fictional API isolation, with no customer financial mutations. Detailed source, local, production and rollback evidence is archived under `docs/release-snapshots/simulator-debt-controls-20261031/`.

Published pages produced a classified CSP refusal for a Cloudflare-injected analytics script. No beacon request left the browser, and no simulator/app failure occurred. This is not a claim of zero console entries; no hosting or CSP settings were changed for this feature.

## Rollback

Before release, the remotely verified annotated tag `rollback/prod-before-simulator-debt-controls-20261031-1908` captured production source `f6608e4c1986d4384d76da49ce63bbe239b2292b` and exact READY deployment `dpl_9MRHuawxYTvLiVZE8skJVnJTFGoA`. Its annotated tag object is `1c03a797044dd6ac3081cebaedf5b3f4962fdafa`.

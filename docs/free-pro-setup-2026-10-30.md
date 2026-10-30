# Free and Pro membership setup

Live at https://flowledger-algo.com. Verified app source: `36d240051fc88a4d45677adccce407d1220ac42f`; READY production: `dpl_3EEJjFUEtNjufQ6HZmkRHxnKAyFs`. All four app aliases point to this exact release.

Standard US pricing is $9.99/month or $79.99/year per household, with household sharing included. Free remains a useful everyday plan. Membership in Settings explains the two plans, current access, selected billing period and Flo allowance.

| Free | Pro |
| --- | --- |
| Unlimited manual accounts, bills, income and transactions | Advanced debt strategies and extra-payment planning |
| Forecast, affordability, basic debt guidance and monthly reports | Saved scenarios, multiple saved comparisons and cloud scenario saves |
| Goals, buckets, matching and one temporary simulator draft | Historical trends |
| Local Flo Essentials and 10 full-chat previews per UTC calendar month per household | Full Flo conversation, confirmed creation and 300 requests per month per household |
| Customization, Privacy Mode, export, recovery, Undo and sharing | All Free tools |

Existing founding households retain their current planning and Flo access through a separate versioned grant. Existing permanent grandfathered Pro remains Pro. Downgrade preserves saved scenario reading, export and deletion, transaction history, committed Flo receipt recovery and ordinary financial records. Founder/admin/permanent-Pro Flo retains the existing configurable daily allowance, rather than consuming the new monthly quota.

The server verifies active household, membership, administrator previews and Pro capabilities. Service-only reservations enforce shared monthly usage; failed provider work can refund its own reservation once. New Flo financial creation is gated after committed-receipt replay, so recovery remains accessible. Existing manual matching, bucket recovery, protected financial calculations and public bank-readiness restrictions remain intact.

## Store setup status

The product manifest is [pro-subscription-products.json](pro-subscription-products.json); setup instructions are in [native-subscription-and-provider-setup.md](native-subscription-and-provider-setup.md). Connected tools do not include RevenueCat or Google Play Console. Their live products, prices, offers and signed purchases have **not** been configured or tested by this release. New checkout stays disabled by default. Existing subscription management remains accessible.

The optional $59.99 first paid year is shown only for an actually eligible, verified store offer that renews at $79.99/year. The adapter validates current localized price, period and purchaser identity and refuses obsolete US annual pricing. Public bank linking is not enabled by a Pro entitlement or checkout setup.

## Verification and release record

The hosted migration is `20261030130824_free_pro_feature_access`, unchanged reviewed SQL SHA-256 `19052bed56c99dbb33fc20c48e59737adc17837ab47f89b5a21e89cc2455ee37`. Independent live catalog checks passed 55/55, no-auth checks passed, and security advisors have 18 expected INFO findings with zero warnings/errors. Flo V3 is ACTIVE version 43 with JWT verification retained; every deployed source file matches the reviewed package. Supabase omits one module containing only types (its emitted runtime is empty). An anonymous request correctly returned 401. All 34 local browser cases/126 checks passed at 390/1,200 pixels; final entry `entry-b50e2278d1022d345c081580671687bb.js` SHA-256 `2d50dc5b68ccd5be7cab23cbbb7830907a4d2c5a9850ad6cecfb7d7294a3a9be`. Published-assets browser verification passed all 34 cases / 126 checks at 390 and 1,200 pixels, including every compact card geometry check. Every downloaded entry exactly matched the local approved bundle. HTTP postflight passed startup/deep routes, health, missing-resource responses, cache rules, service worker, guide PDF and source/alias provenance. A real anonymous REST probe confirmed the new membership RPC is registered and rejects execution with HTTP 401 / PostgreSQL 42501. Local verification already passed 1,510 mobile tests, five performance checks, 218 API tests, 572 Edge tests, 37 release-fixture tests, workspace/mobile typechecks, guide and artifact-copy checks, and 111 real PostgreSQL integration assertions. Full Deno entry checking still has 146 pre-existing baseline errors; the new helper checks passed and no changed-file errors were introduced.

Phone/desktop checks use actual exported application bytes with fictional intercepted financial and AI APIs. No signed-in customer test sessions, hosted customer financial test writes or real provider calls are used. Native store/device execution is not claimed. Visual review caught and fixed compact Pro cards collapsing on mobile; the final browser gate checks card geometry as well as actions, quotas, access failures and data retention.

The remotely verified rollback point is `rollback/prod-before-free-pro-setup-20261030-1217`, capturing previous production source `e77f5e6b48bb62baf097aa0ecece9e9344646996`. Backend rollback requires coordinated frontend/old Flo restoration and reversal only of the new creation guards at their verified boundaries. Retain all grants, counters, receipts, scenario data and financial records. See [free-pro-backend-2026-10-30.md](free-pro-backend-2026-10-30.md).

Evidence: [release snapshot](release-snapshots/free-pro-setup-20261030/), including exact pre-release Flo source for coordinated rollback.

The final browser matrix reported zero uncaught application errors, unknown requests, financial record mutations, canonical Flo creation calls, or real customer/provider writes. Billing and native receipt testing remain the external store readiness step described above; application release verification does not claim those tests.

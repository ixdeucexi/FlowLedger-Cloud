# Weekly account tips

The notification bell and push delivery use the same six educational reminders in `artifacts/mobile/lib/accountTips.js`. One tip is selected for each UTC Monday week. Tips explain planned money, pending charges, posted-activity review, bill timing, savings buckets, and balance checks. They contain no account names, balances, or personalized spending recommendations.

`Settings → Notifications → Account tips` controls both the bell and enabled push destinations. The bell waits for the signed-in household's budget, notification history, and preferences to load. It shows only the current week's tip and preserves the existing household-scoped read/dismiss history. Demo mode does not fetch tip preferences.

Opening a weekly tip shows its explanation in an overlay. The action button alone opens the relevant screen; closing the overlay leaves the current page in place. Bell tips and phone/browser notification taps use the same catalog content. Push links carry only a validated public week marker, so an older notification can explain the tip that was actually sent. Explicit taps on already-delivered tips remain available after opting out of new tips. An overlay is hidden and its action disabled whenever the verified account/household scope changes.

The authenticated cron endpoint `/api/notifications/account-tips` runs Wednesdays at 15:30 UTC. It queues one event per subscribed user per week, using the user's current active household and rechecking membership. The existing outbox, claim, and native receipt handling perform delivery. Before sending, eligibility is checked again; opted-out, read, dismissed, stale-week, or changed-household tips are retired without sending. Browser tips are silent; native tips use the quiet `flowledger-tips` channel. Existing financial alerts keep their delivery settings and badge behavior.

## Release order

Apply `supabase/migrations/20261116030723_account_tip_notifications.sql` before deploying the matching API and app. It adds the `account_tips` preference and permits weekly `account_tip` outbox events while preserving existing event constraints and service-only table access. It does not send notifications. Deploying the code activates the weekly scheduler; no additional notification credentials are required.

Before rolling back to code that predates account tips, stop the new cron and retire pending `account_tip` outbox rows (`delivered_at` set, delivery claims cleared). Older workers do not recognize the new event type. Leave the additive preference column in place during a code rollback.

## Verification

- Catalog tests cover weekly stability, UTC/year boundaries, rotation, copy length, and allowed destinations.
- Backend tests cover opt-out, read/dismiss, household membership, stale events, retries, user-wide deduplication, paginated recipients, and cron authentication.
- Frontend tests cover preference request races, account/household switching, notification history, and weekly tip navigation.
- Browser fixtures using the actual hero JSX/styles verify equal face heights and a stable Accounts position across flips, expanded buckets, many accounts, and larger text at phone and wide layouts. The actual tip modal is checked at phone, desktop, and short viewport sizes for closing, Escape, and explicit destination navigation.
- The migration was executed twice in an isolated PostgreSQL engine: existing alerts and opt-outs survived; weekly constraints, uniqueness, RLS, and denied client access were checked.
- Push transports were mocked. Physical notification delivery requires a configured device during release verification.

On the mobile/PWA dashboard, the checking face sets the flip card's responsive height. The savings face fills that same space and scrolls internally, so flipping or expanding buckets does not move Accounts below the card. “Goals & buckets” starts collapsed each time the card flips to savings; balances and Add/Edit actions remain available.

# Launch and resume routing

- A fresh JavaScript runtime has no remembered route. An authenticated, onboarded launch at the app's `/` entry opens Dashboard after the existing scoped core/privacy readiness checks.
- A still-open app retains its router state and runtime-only, user/household-scoped last page. Background/foreground and page visibility events do not redirect. If that runtime revisits the entry/login route, restoration reads its latest page synchronously, not an earlier prefetched snapshot.
- Sign-out clears that user's runtime routes across households. It does not erase unrelated interface preferences. Older persisted `lastRoute` preferences are no longer read or written by navigation.
- Explicit non-entry URLs, password reset, onboarding, and notification navigation keep their existing handling. Route restoration has no storage timeout or delayed promise callback that could override a later deep link.

## Platform boundary

The PWA manifest's `start_url` is `/`. If the operating system discards the entire app runtime and later reconstructs a non-root URL, the app cannot reliably distinguish that reconstruction from an intentional deep link. It honors the URL rather than destroying explicit navigation. A normal fresh launch from the app icon uses Dashboard; retaining a live runtime preserves its current page. Real-device OS lifecycle behavior still requires phone verification.

## Checks

`navigationMemory.test.ts` exercises cold memory, latest warm route, user/household isolation, sign-out clearing, readiness and entry eligibility, and absence of delayed redirection. `startupBrand.test.ts` binds these guards to AuthObserver. These are unit/source-contract tests, not a claim of device-level lifecycle testing.

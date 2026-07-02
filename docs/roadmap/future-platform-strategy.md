# FlowLedger Future Platform Strategy

Saved for later. Do not begin this migration until the core FlowLedger product, Flo, and Algorithm Suite are stable.

## Goal

FlowLedger should eventually operate like a full professional finance product:

- A polished public website.
- A web app / PWA users can install instantly.
- Native iOS and Android apps for the app stores.
- One shared backend and one shared financial calculation engine.

## Target Architecture

### 1. Next.js marketing website

Use Next.js for the public/professional side of FlowLedger:

- Homepage.
- Features.
- Pricing.
- Security / privacy.
- Help pages.
- Blog or education content.
- Sign up / login entry points.

This gives FlowLedger a stronger web presence without forcing the app itself to be rebuilt immediately.

### 2. Web app / PWA

Keep a browser-based app that users can log into and install from the web.

The PWA should feel app-like:

- Fast loading.
- Clean splash screen.
- Install prompts.
- Mobile-first layout.
- Strong offline/error handling.
- Shared auth and data with the native apps.

### 3. Native mobile app

Package FlowLedger for iOS and Android using Expo/EAS or the best app-store route at that time.

The native app should reuse the same product logic as the PWA:

- Forecasting.
- Flo.
- Algorithm Suite.
- Bills.
- Transactions.
- Goals.
- Debt.
- Settings.

### 4. Shared core logic

Move important deterministic logic into a shared core package/folder so every platform calculates the same results.

Shared logic should include:

- Forecast engine.
- Flow Score.
- Safe Cushion.
- Purchase Decision.
- Bill Priority.
- Payday Split.
- Debt Payoff.
- Low Balance Warning.
- Risk Day.
- Spending Limit.
- Flo deterministic responses.

### 5. Supabase backend

Supabase remains the shared backend:

- Auth.
- Database.
- RLS security.
- Edge functions.
- Storage.
- User data.
- Flo context.

## Recommended Sequence

### Phase A — Stabilize current app

Finish the core product first:

- Make Algorithm Suite genuinely useful.
- Clean up Flo.
- Finish budget, calendar, bills, debt, goals, transactions, and settings workflows.
- Preserve no-lag performance.

### Phase B — Extract shared logic

Move financial logic out of screens into reusable modules/packages.

This makes future Next.js and native work much safer.

### Phase C — Build Next.js marketing site

Create the professional public website while keeping the current app working.

This gets the “big company” web presence without pausing product development.

### Phase D — Polish PWA shell

Improve:

- Install experience.
- Icons.
- Splash screen.
- Theme color.
- Loading states.
- Mobile navigation.
- Error recovery.

### Phase E — Native app store build

Package and submit the mobile app once the product is stable enough for review.

### Phase F — Optional full Next.js app rebuild

Only rebuild the logged-in app in Next.js if there is a strong reason later.

Do not rebuild just because Next.js is popular. Rebuild only if it gives a clear advantage in performance, maintainability, deployment, or user experience.

## Guiding Principle

Do not abandon what works.

Build the professional platform around the current product first, then migrate pieces only when the benefit is obvious.


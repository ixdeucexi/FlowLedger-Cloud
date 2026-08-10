# Website + PWA UX Polish milestone

## Current architecture

- **Framework:** Expo Router, React Native Web, TypeScript, and TanStack Query.
- **Routing:** one shared `(tabs)` route tree serves desktop web, responsive web, and the installed PWA. Desktop presentation is selected at the responsive shell; business routes and data remain shared.
- **Authentication:** Supabase Auth is restored through `AuthContext`; the authenticated session is shared by all responsive presentations.
- **Households:** `BudgetContext` owns the existing household switcher, active membership, budget scope, and household-scoped query key. This milestone does not replace it.
- **Data:** bills, income, debts, goals, activity, forecasts, settings, Plaid records, and decisions come from existing Supabase queries and shared calculation utilities.
- **Preferences:** `user_preferences` already stores user-owned JSON preferences and the active household. Device-local navigation state is safe presentation state only and is scoped by user and household.
- **Responsive shell:** `DesktopChrome` is used at 1024px and above; Expo Tabs and the existing five-item mobile ribbon remain below 1024px.

## Implementation stages

1. Fix page scrolling, make desktop and mobile navigation geometrically stable, restore household-scoped routes and page state, and keep application chrome visible while data restores.
2. Add historical Activity ranges, query paging, shared filters, search, correct transfer handling, running balances where supported, and CSV export.
3. Promote the existing Reports, Insights, and Review Center implementations and standardize readable premium card surfaces.
4. Split the existing “How Your Path Works” content into an accessible, responsive walkthrough.
5. Add household-scoped dashboard layout preferences and the shared “Today’s Decisions” widget using existing calculations.
6. Reuse one household-safe search layer for universal search and the command palette, and add an in-app notification center backed by real application events.
7. Optimize expensive routes and queries, complete accessibility and responsive regression checks, and deploy through preview to production.

Each stage is committed independently on the development branch and verified before the next stage.

## Planned code areas

- Shared shell/navigation: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `components/desktop/DesktopChrome.tsx`, `lib/mobileRibbon.ts`
- Restoration/preferences: `lib/navigationMemory.ts`, a new household-scoped UI preference module, Calendar, Activity, and Settings route state
- Activity: `app/(tabs)/transactions.tsx`, `components/desktop/DesktopActivityPage.tsx`, shared Activity range/query utilities
- Discoverability: shared route definitions, Reports/Review route wrappers, Dashboard quick actions, More/Menu links
- Surfaces and walkthrough: theme tokens, shared card/modal components, `app/(tabs)/how-flowledger-works.tsx`
- Dashboard: desktop/mobile Dashboard components and scoped layout-preference utilities
- Search/notifications: reusable search and notification models plus responsive desktop/mobile presentations
- Tests: unit tests for route sanitization, range math, transfer classification, preference scoping, recommendations, and notification deduplication

## Principal risks and safeguards

- **Authentication flashing or redirect loops:** do not redirect until both the session and active household resolve; sanitize restored routes and fall back to Dashboard.
- **Household data leakage:** key every saved UI state and every new query by authenticated user and active household; clear household-specific caches on switching.
- **Financial-result drift:** reuse existing forecast, bill, snowball, goal, and transfer classification logic; add presentation selectors rather than another calculation engine.
- **Mobile regression:** retain the existing mobile routes, card layouts, and five-item ribbon; use responsive presentation branches only.
- **Large ledgers:** page remote Activity records and lazy-load heavy reporting UI instead of loading all history into the browser.
- **Offline ambiguity:** retain the current route and cached presentation, show explicit offline/error state, and never claim an unsupported offline write succeeded.
- **Database risk:** prefer existing preference JSON fields; any schema addition must be additive, RLS-protected, user/household scoped, and documented in a migration.

## Release gates

- Type checking, automated tests, and production build pass.
- Desktop checks at 1440, 1280, and 1024 pixels.
- Responsive checks at 768, 430, 390, and 360 pixels, plus available standalone-PWA verification.
- Auth restoration, household isolation, historical Activity totals, transfer deduplication, and route/filter restoration are explicitly smoke-tested.
- Development preview is validated before merging to `main`; production is then verified at `flowledger-algo.com`.

# Appearance presets and customization

Status: live at https://flowledger-algo.com on October 29, 2026. Production postflight passed.

Settings > Appearance & feedback now includes five presets: FlowLedger, Ocean, Mint, Sunset and Paper. Users can adjust Light/Dark/System mode, six curated accent choices, Ambient/Subtle/Plain backgrounds and Standard/High contrast, with a live example preview. Choices apply immediately and save on the current device. Reset restores the original appearance without changing independent Flo visibility, touch feedback or financial settings.

The same controls serve the actual phone and desktop Settings route. Native/mobile palettes, desktop CSS variables and shared backdrops consume the preferences; direct FlowWaveBackground callers now respect light mode. Financial status colors and opaque modal surfaces retain their meanings and behavior. DesktopSettingsPage is currently dormant and was updated for source parity, not represented as a separate tested runtime route.

Preferences use bounded versioned local JSON, migrate the legacy theme, reject unsupported fields, serialize writes and guard delayed hydration against newer choices. Load and save failures have separate recoverable actions; retrying a failed load does not write defaults. No database or authentication changes are required.

Verification: independent source review and nine focused appearance checks; complete release verification passed 217 API, 563 Edge, 37 release-fixture, 1,387 mobile and five performance checks, workspace types, export, guide/artifact checks and audit policy. Expo Doctor passed 18/18. Fifty browser checks passed across 390/1,200-pixel layouts, including all presets and controls, reload persistence, OS color-scheme changes, save-error recovery and reset independence. Eight actual Dashboard/Bills/Forecast/Flo screens were inspected in Mint; opening Flo sends no automatic question. All 471 external application requests were intercepted with fictional records; no reconciliation occurred. No browser errors, warnings, unknown requests or horizontal overflow occurred. Native hardware behavior is not claimed by viewport checks.

The required audit detected newly reported GHSA-qr28-fpjm-wq7f in the existing decode-uri-component 0.5.0 override. Only that override and lockfile entry were updated to compatible patch 0.5.1. Navigation decoding cases and a 10,000-run malformed-input check passed; no audit exceptions were added. Existing findings remain one low, one moderate and three previously ignored high advisories.

Candidate: `entry-2001167ca0fd98c5a4f612aa024107d9.js`, SHA-256 `55e30bb51f4609e8b7fa3537853e175ab75bcb047be7641b3da3ba396aa36a61`.

Rollback: `rollback/prod-before-appearance-customization-20261029-2115`, remotely verified annotated tag at source `637e840ed028fc72568ba10368506a1f98995787`, exact READY deployment `dpl_7cuYo4XL73dGtrhgNxdcdSQPa1Sv`. Production-only environment metadata and the canonical Vercel project were verified. No credentials were retrieved or changed.

Evidence: `release-snapshots/appearance-customization-20261029/`.

## Production release

- Clean reviewed source: `f624ed3de446fd769d2882d4f33f9b870bfabada`, pushed on `dev`; source/config/guide guards passed in a clean isolated release checkout. Marketing files remain outside the release source.
- READY deployment: `dpl_GjLc7fLqCcUVSYdzCGV3qxA6dUdx`, immutable https://flow-ledger-cloud-qjjm0p70o-flow-ledger-s-projects.vercel.app. All four app aliases were freshly verified and aligned; the legacy alias required reassignment. Only the duplicate non-production build of this exact commit was canceled.
- Complete repository HTTP postflight passed with fresh connected-tool inspection observations; observed GitHub commit metadata was mapped to the equivalent CLI field without inventing provenance. Startup/routes, cache policies, health/missing-resource responses, guide/worker parity and executable assets passed. The published entry's SHA-256 exactly matches the browser-tested candidate above.
- Fifty appearance checks passed again using the actual published assets at 390/1,200 pixels with fictional authentication/records and every financial request intercepted. All main-screen light-mode checks, saving/reset/error recovery and System-theme behavior passed. No application errors, unexpected console events, unknown requests, overflow or live financial test writes. Existing injected Cloudflare beacon CSP blocks were classified separately. Browser contexts and local servers were closed.
- Independent candidate review passed; no backend deployments, migrations or environment changes were made. The rollback tag and exact prior READY deployment above remain available.

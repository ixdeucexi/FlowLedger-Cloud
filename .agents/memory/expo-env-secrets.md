---
name: Expo env secrets in Replit workflows
description: Replit secrets are NOT auto-injected into workflow process envs; EXPO_PUBLIC_* vars must be written to .env.local in the mobile artifact dir.
---

## Rule
Replit secrets (e.g. `EXPO_PUBLIC_SUPABASE_URL`) are available in the **agent's bash shell** but NOT in workflow process environments. Expo's Metro bundler reads `EXPO_PUBLIC_*` vars from `.env.local` at bundle time (via babel-preset-expo).

**Why:** The agent shell and workflow processes run in separate contexts. Replit injects secrets into the interactive agent shell but not into the workflow daemon processes.

**How to apply:** When a new `EXPO_PUBLIC_*` secret is added or this problem recurs, run:
```bash
printf 'EXPO_PUBLIC_FOO=%s\n' "$EXPO_PUBLIC_FOO" >> artifacts/mobile/.env.local
```
The `.env.local` file is gitignored and must be re-created if the Repl is cloned or the file is deleted. `app.config.js` + `Constants.expoConfig.extra` approach also failed for the same reason (process.env is empty in the workflow).

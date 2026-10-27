# Saved simulator scenarios

Date: October 27, 2026. The owner requested separate saved scenarios that users can reopen, edit and weigh against each other. Standing authorization covers publication after verification.

Status: source and browser verification passed; publication and production postflight are pending.

## Behavior

- Save named options, reopen them from a searchable picker, update an existing option, duplicate, rename or delete it. Working edits remain separate from saved definitions until the user explicitly saves them.
- Switching away from unsaved work offers Save & switch, Discard & switch and Keep editing. Deleting a saved option keeps the open working copy.
- Compare two distinct saved options beside Current plan. All three use one current baseline, date range, safety floor and reference set. Users can change the common horizon without changing either saved horizon. Missing targets, incomplete date coverage and below-zero results remain visible.
- Named on-device options remain available after signing back in to the same account on the same device. They do not sync between devices. Clearing app data or deleting the account removes them. User, household and demo namespaces remain separate. Existing eligible household cloud saves retain their permissions and optimistic version checks.
- A valid existing draft is imported once after the new library is written and verified. Its original backup is retained. Corruption, storage failures and revision conflicts are reported without silently trimming saved definitions. Reload saved scenarios retains unsaved working values.

Only scenario definitions are saved; results are rebuilt from current records. The financial engine, backend functions, schema, subscription entitlements and dependencies are unchanged.

## Verification

- 86 focused tests passed. SENTINEL independently passed 89 compiled checks including chip scrolling, library, comparison, editor, engine, history and Founding Free guards. New regressions execute delayed local/cloud saves, actual loader completions across A→B→A, failed-load readiness, independent device/household recovery, stale saves/deletes, two-tab library serialization and reload with unsaved values intact.
- The full mobile suite passed 1,331 tests in 14 suites. Workspace/mobile typechecks, web export, 217 API tests, 467 edge tests, 37 release fixtures, all 18 Expo Doctor checks, mobile configuration, guide and final artifact checks passed.
- Production dependency audit passed the configured high-severity threshold: one moderate advisory and three existing ignored high advisories, without dependency or ignore-policy changes.
- The frozen final browser candidate is entry `3003cad1248ecfdceaef0b1928697fcb`, SHA-256 `704405d9b72373799148660d2f1e02c23e6eec4a840d6bf8f251402540df6954`.
- Actual two-tab browser checks reject stale saves, reload without replacing unsaved work and retry while preserving other saved options. Quota failure/retry, physically blocked edits during a held save, resumed editing and A→B→A storage/publication isolation also passed. These checks used entry `7b334e51495c2da4789abce530c6a7f4`, SHA-256 `016cb6280149e5f3ac9ebe9dae4045f84e4e092afd5412b29dda73b007316802`, before the bounded independent-load recovery repair.
- On the exact final build at 390/1,200 pixels, SENTINEL verified that corrupt device storage remains untouched, local saves/autosave stay blocked and authorized household scenarios still open and update through the existing mocked optimistic API. Reload preserves unsaved working values. No unexpected page/console errors or customer financial writes occurred.
- Exact final-build phone/tap and desktop/keyboard journeys passed Save A → Duplicate B → edit/update B → reopen both, with A unchanged. Comparing saved 3/12-month options over a common 6 months produced the expected $100/$200 differences; refreshing a $1,000 baseline change moved all three results equally. Rename retained IDs, deletion cleared stale comparison selections and duplicate comparison choices were rejected. Screenshots are archived at `/workspace/artifacts/simulator-saved-scenarios-preview-2026-10-27/`.
- Exact final-build migration/auth checks preserved the legacy backup byte-for-byte, imported once with a stable ID, recovered a failed migration without duplicates and retried a failed library save while keeping unsaved work. Actual Sign out executed the app cleanup: named definitions remained byte-identical, user B could not see user A's options and signing back in as A restored both named options. Five separate projection-performance checks also passed.

- Final-build Save & switch saved B's changed amount before opening A unchanged. Missing-reference, out-of-common-range and below-zero warnings remained visible, large amounts stayed inside cards and the existing debt editor's Cancel/Back path still reached Forecast. Normal real mode ignored and preserved a seeded demo library.

SENTINEL approved the whole source/browser release gate, including bounded carryforward of the earlier concurrency checks: the final delta only isolated device/household load and reload outcomes and restored eligible cloud controls. Storage transactions, locks, epoch ownership and busy guards were unchanged. Browser scenarios used fictional records and intercepted local responses; no customer financial writes were used for testing. All test browsers and loopback servers were closed. Raw fixture credentials, request headers and storage logs are not copied into this repository.

## Rollback and layout snapshot

Production rollback tag `rollback/prod-before-scenario-library-20261027-1939` was created and remotely verified before publication. It captures live application source `e0fff627c3fb71f1c690b8cf9e0aa82eae38884e` and READY deployment `dpl_6XqBU8VrVHpfhZy6gDbZS5KvZzwh`.

The owner's earlier layout checkpoint remains `checkpoint/simulator-before-redesign-20261027-1905`, commit `56bd49da66caea2d89dfcce9b326d271a5caa6a5`. Its full workspace archive and fictional phone/desktop screenshots remain at `/workspace/artifacts/simulator-before-redesign-2026-10-27/`.

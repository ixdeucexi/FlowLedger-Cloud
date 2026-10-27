# Simulator redesign and editable scenarios

Date: October 27, 2026. The owner requested an app-consistent simulator, editable changes, a stronger layout redesign, and a snapshot before rearranging it. Standing authorization covers publication after verification.

Status: independent whole-release review passed. Source, functional and exact-build visual/physical-action checks passed; production release and postflight pending.

## Changes

- All 12 existing change types support Edit, Update and Cancel. Updates retain the original ID, type, order and count. Editable fields include amounts, names, dates, recurrence and the selected income, bill or debt where applicable. A debt payoff amount remains calculated by the existing engine.
- Desktop places the scenario and change cards beside the comparison. Phone separates Build and Compare, with negative/incomplete-result status visible from Build. Add/Edit opens one focused, opaque sheet/dialog instead of a permanent long form.
- Clear summaries, larger comparison text, stacked phone values and a full-width phone Add change action improve readability. Existing desktop debt arrows remain available.
- Saved-scenario commits are blocked while the editor contains an unfinished change. Cancel, X, Escape and Back discard only the unfinished form. Reset, New, scenario selection and scope changes close it. A single editor survives resizing.
- Simulator-owned browser history consumes its own entry on explicit close; Back closes once and subsequent Back reaches the prior route. Shared history hooks and the shared date picker were not changed.
- Scoped local autosave waits for the matching draft load to settle before writing. Loader ownership includes identity and loading policy; stale completions cannot claim a different scope. Error/malformed-load recovery remains usable.

The financial engine, projection formulas, backend APIs, schema, subscription permissions and dependencies are unchanged. Changes remain hypothetical; tests use fictional records and mocked network responses.

## Verification

- 67 focused checks passed, independently rerun by SENTINEL. They cover all change types, identity/order, validation, missing targets, actual load/autosave effect ordering, recovery and owned asynchronous history traversal.
- Full mobile suite: 1,309 tests in 14 suites passed. Workspace/mobile types, web export, 217 API tests, 37 release fixtures, all 18 Expo Doctor checks, mobile configuration, guide and artifact checks passed.
- Production dependency audit passed the configured high-severity threshold: one moderate advisory and three existing ignored high advisories, with no dependency or ignore-policy change.
- Mock-authenticated browser checks passed 24 add/edit/cancel/update journeys across 390/1,200 pixels, plus strict money/date validation, horizon repair, unchanged real baseline, recalculated scenario, debt arrows, resize, focus, reset and scope isolation. Raw storage-write assertions reject any old-user change under a new-user key, including transient writes hidden by later hydration.
- Mocked Pro persistence verified disabled Save/Rename/Duplicate during editing, then PATCH of the same scenario/change identities and unchanged order/count, followed by reloading the edited value. No real financial writes were sent.
- Actual browser history checks verified repeated explicit-close/update cycles remain bounded; Back closes the editor once and the next Back reaches Forecast. Inline calendar Back discards the whole unfinished editor.

Functional/history evidence used entry `7f7fe7b20e3525d25e33d09dc73c7a60` and the subsequent opaque-surface build. The final entry `9a401a7095ee72d3e0c8439b0edf2a09`, SHA-256 `216819b59ad494a945a464d8b56c194460ff63ccf0c801ad04987a149cd5503a`, differs only by an opaque modal surface and phone Add-button presentation. SENTINEL verified this bounded carryforward; final exact-build visual/physical-action smoke passed at both widths: opaque sheets inside the viewport, unobstructed phone Add-button center hit/tap, Add/Edit/Update with stable identities, Cancel/Escape with focus return, and Back closing once then reaching Forecast. No unexpected console/page errors, overflow, real financial writes or unhandled external traffic were recorded. All browsers and the loopback server were closed. SENTINEL independently approved the complete release gate. Raw fixture credentials, headers and storage logs are not copied into this repository.

## Requested snapshot and rollback

- Pre-redesign layout checkpoint: `checkpoint/simulator-before-redesign-20261027-1905`, commit `56bd49da66caea2d89dfcce9b326d271a5caa6a5`, pushed and remotely verified. It preserves the editable long-form layout before structural rearrangement, not an asserted production release.
- Workspace archive: `/workspace/artifacts/simulator-before-redesign-2026-10-27/`, containing the exact full web export, six source files, manifests and 22 phone/desktop screenshots using fictional records. Export SHA-256: `5aed6a5241af0411d4e00c53f4eca62a812985e644aabee5c0ea33aeabc98748`.
- Production rollback: `rollback/prod-before-simulator-editor-20261027-1852`, pushed and remotely verified, captures source `02179cb548f6066de75c5d22803c7794d6e852df` and deployment `dpl_HAvp3QGcJXZXs9eDaonkiSkdgm95`. Backend functions are unchanged by this release.

## Release

Production deployment and postflight remain pending. Exact reviewed commit, deployment, alias inspection and live checks will be recorded after release.

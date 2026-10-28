# Visible pending-payment suggestion

Date: October 28, 2026. The owner asked for the suggested match to appear directly in the pending-payment sheet, without choosing a type filter first. Standing authorization covers publication after verification.

Status: live and verified. Source, functional browser and production HTTP/provenance gates passed. The public browser console diagnostic is recorded below.

## Change

The pending-payment sheet now places one strongest eligible Suggested card immediately after Create transaction and before the Bill, Debt and Manual transaction filters. It remains available when the filter changes. Its label comes from the suggested target's own type, and its name, amount, date and existing reasons are shown.

The suggestion uses existing eligibility and the existing score threshold of 48. The canonical ordering comparator was extracted unchanged and shared with the selector; scoring formulas are unchanged. The complete lists remain under their existing filters. Nothing is matched automatically: tapping the card invokes the same guarded bill/debt or manual handler with the exact target ID. The already-matched status/removal view and posted-transaction matching are unchanged.

The unmatched sheet body scrolls as one region beneath its fixed header, keeping the added card and lower controls reachable on short phone screens.

## Verification

- 25 focused tests passed, independently rerun by SENTINEL. They cover cross-type ordering, current-target eligibility, weak/empty cases, immutable candidate inputs, filter independence, actual card rendering and explicit handler dispatch.
- Full mobile suite: 1,335 tests in 14 suites passed, plus five separate performance checks. Workspace/mobile typechecks and web export passed.
- 217 API tests, 467 edge tests, 37 release fixtures, mobile configuration, guide, final artifact and all 18 Expo Doctor checks passed.
- The production dependency audit passed its configured high threshold: one low and one moderate advisory, plus three existing ignored high advisories. Dependencies and ignore policy were not changed.
- Frozen browser candidate: entry `c656131bef30648ab19e0b1a7655cfeb`, SHA-256 `cc9ffb7738d29ed9a44f5a1f5bedcd64a98fc90a7851e6429e196256cf77c598`.

Eight actual browser cases passed on the exact frozen candidate, including 320×568, 390-pixel phone and 1,200-pixel desktop layouts. The suggestion appeared without a filter, retained its own Debt label across Bill/Debt/Manual selection and stayed above the controls. Physical tap and keyboard actions linked the exact target only after selection; a held save accepted one write despite a second tap. Existing matched-status removal, bill and manual suggestions, weak/empty candidates and long names also passed. Controls were reachable without overflow or unexpected page/console errors.

Browser checks used fictional records with all network responses intercepted. Only mocked pending-match writes were accepted; no customer transaction or bill writes were sent. Test browsers and loopback servers were closed. Raw authentication/storage logs are not copied into this repository.

SENTINEL approved the complete source/browser release gate. Settled fictional screenshots are archived at `/workspace/artifacts/pending-suggestion-preview-2026-10-28/`; intermediate animation captures are excluded from the preview archive.

## Rollback

Annotated tag `rollback/prod-before-pending-suggestion-20261028-1124` was pushed and remotely verified before publication. It captures the currently live application source `44f499820d2b4e97e90c537161ee14f41c745f0d` and READY deployment `dpl_C8REwmuCJtegqjPeSe7bGsrrdEV1`. No backend function or schema change is planned.

## Release

Reviewed application source `93143d52f10d5cdec95f5ff6d8de5e8f492a953e` was committed, pushed and verified clean before publication. Production deployment `dpl_6w95qHbXTPZQz4u3D4jBHff6AYCD` is READY at immutable URL `flow-ledger-cloud-jtpg14h67-flow-ledger-s-projects.vercel.app`.

The canonical, www, project Vercel and legacy team domains were inspected after readiness; all four resolve to the same production deployment and source. The legacy alias was explicitly moved after readiness. Canonical project/team identity, Node 24 and the Production-only metadata scope of all 14 environment records (13 required names) were checked without inspecting plaintext credentials. The deployment request explicitly supplied the repository build/install/output/root contract.

Production HTTP postflight passed exact source provenance, registered public routes and Activity module, no-store SPA HTML, immutable executable JavaScript containing the new suggestion controls and preserved simulator/Flo signatures, health 200, missing API/asset 404, exact no-store service worker and guide-PDF parity. Authenticated Vercel MCP inspections replaced CLI metadata reads while retaining the repository assertions and equivalent GitHub commit metadata field.

Fresh public browsers at 390/1,200 pixels opened `/transactions`, reached the expected sign-in boundary and recorded zero page errors, overflow or write attempts. These checks are separate from the fictional authenticated matching tests and do not claim a customer financial session. Both public widths logged a CSP refusal of an external Cloudflare analytics script. The strict zero-console check therefore did not pass; that diagnostic was retained without suppression or a CSP change. The CSP, app HTML and dependency declarations are unchanged from the preceding release, and no Cloudflare beacon appears in the reviewed app source or candidate JavaScript. A historical browser baseline comparison was not claimed. Matching and app startup were not blocked.

Runtime inspection observed only the known Node `DEP0169` `url.parse()` deprecation warning from the successful health check; this is not a claim of zero log entries. No Supabase function, schema, dependency or environment configuration change was made.

Release verification is complete. This postflight report update is documentation only; the live application remains the reviewed source above.

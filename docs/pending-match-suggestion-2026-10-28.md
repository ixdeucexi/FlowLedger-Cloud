# Visible pending-payment suggestion

Date: October 28, 2026. The owner asked for the suggested match to appear directly in the pending-payment sheet, without choosing a type filter first. Standing authorization covers publication after verification.

Status: source and browser checks passed; publication and production postflight are pending.

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

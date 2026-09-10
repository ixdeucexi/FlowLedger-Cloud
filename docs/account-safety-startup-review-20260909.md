# Account safety, payday guidance, and launch review

## Scope

Preserve FlowLedger's navigation and visual identity while improving financial
clarity, truthful persistence, and startup routing. No database schema, bank
integration, authentication privilege, or debt-allocation changes.

## Changes

- A fresh app runtime starts on Dashboard at the normal root entry. A still-open
  runtime remembers its page, scoped to user and household. Explicit deep links
  remain valid; device-restored non-root URLs are not rewritten as cold launches.
- Dashboard payday guidance now opens the relevant income, bills, or Forecast
  screen and explains that required payments and the user's cushion come first.
- Account editing preserves negative balances and rejects blank/invalid input.
  Accounts replaces an unsupported projection that double-counted reconciled
  transactions with the authoritative balance's as-of date.
- Category budgets distinguish a blank automatic bill-derived amount from an
  explicit zero. Save failures retain drafts and do not claim confirmed success.
  Dashboard category editors also wait for persistence and prevent double saves.
- Goals show target pace rather than claiming an arbitrary percentage of income
  is safe to save. One dated canonical Forecast cushion is shared by all goals.
  Contributions are explicit records, not bank transfers; amount, optional source,
  confirmation, permission, and stale-plan checks are visible and enforced.
- Reports show actual overspending percentages, including above 100%, with a
  bounded progress bar and explicit zero-income handling. Extra debt payments
  direct users to affordability review rather than relying on monthly net flow.
- Biweekly income is labeled Every 2 weeks. Date-sensitive review and Simulator
  screens update at the local day boundary without resetting scenario drafts.

## Verification and limits

The first production candidate (`270eb96`) passed automated gates but failed the
live contribution interaction: its input Modal covered the shared confirmation
dialog. Production was immediately restored to the exact prior deployment.
The replacement must use one modal for entry/review, pass an actual contribution
browser test on an unpromoted production artifact, then be promoted unchanged.
Signed-in review also reproduced a pre-existing Settings Back race; explicit
empty section parameters now select overview without restoring stale preferences.

The initial full verify run passed 1,189 tests, workspace typechecks, mobile web
export, and release artifact checks. Independent review covers actual changed
source and persistence failure/race cases; release preflight repeats full checks
against the final committed source.

Only an isolated QA account with fictional balances, income, bills, debt, and a
savings goal is used for signed-in browser checks. No real user's financial data
is edited. Flo's live AI testing remains gated on confirmation to reuse the
existing server-side connection. No claim of full Flo account-answer coverage or
physical-device PWA cold-start performance is made by this release.

Category persistence retains the existing multi-request remote protocol: partial
remote failure is possible, but is surfaced rather than presented as a successful
save. Existing dependency audit exceptions remain documented in SECURITY.md.

## Rollback

Pre-release live deployment: `dpl_ExVEMXvXHF85jx26anpRT921nkRy`, source
`e79b13a71e192f100d6777127e2478ccd983d89b`.

Annotated remote rollback tag:
`rollback/prod-before-reviewed-account-safety-20260909` (verified after restoring
the prior live deployment). The earlier pre-release tag is also retained.

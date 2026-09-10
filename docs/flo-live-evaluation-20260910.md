# Flo live evaluation — September 10, 2026

Status: final candidate verification passed; production promotion and postflight pending.

## Scope and environment

Authenticated version-3 SSE requests against `flo-chat-review`, using only the synthetic QA owner's household. Responses are checked for completed answers, intent, dates, financial arithmetic, and honest missing-data limitations. HTTP 200 alone is not a pass. The QA fixture has a dated $500 checking observation, scheduled $1,500 biweekly income, $900 rent, and a $1,000 debt with a $35 configured payment and 18% APR. It intentionally lacks sufficient historical spending and current verified funds to authorize extra spending.

The representative inventory contains 74 questions spanning all 30 requested headings. It is finite; passing it cannot guarantee every possible wording or turn unavailable financial data into a verified answer. Missing named accounts, credit limits, historical debt balances and spending history must remain explicit.

## Findings and repairs

- Review v8: the initial 74-question corpus had 17 failed requests, in addition to scope/date problems. Supplementary attempts are retained separately.
- Review v9: 38 targeted retests had 10 failed requests plus four wrong scope/date answers.
- Review v10: 20 targeted retests had seven failed requests and the wrong weekday answer.
- These failures prevented production promotion. They were not relabeled as successes or hidden by a generic financial summary.
- The repaired interpreter has a bounded typed-intent path for unambiguous requests, using the existing financial calculators. Complex or contextual questions retain model interpretation. Null outer amounts are kept distinct from scenario amounts, dates use calendar logic, and parser boundaries preserve explicit scopes.
- Saved conversation context is not discarded in the direct path; failed settings or history reads return an explicit clarification rather than assumed account scope, timezone or debt method.
- Bill-price scenarios preserve recorded settlements and do not invent refunds. One-occurrence scenarios report the actual scheduled occurrence. Debt-versus-savings guidance uses a single verified optional capacity, not independent allowances for the same dollars.
- Automated checks at the review-v11 freeze: 262 Edge tests and Deno checking passed. Independent review approved review deployment only, pending live evidence.
- Review v11's 20 targeted live retests passed independent review. A two-turn buffer follow-up retained the $1,000 target but did not explicitly acknowledge the proposed contribution. Review v12 corrected that; its two-turn live retest acknowledged $100 per paycheck without inventing an affordable contribution or payoff date.
- Review v12 completed the 74-question corpus at 17:26:07 UTC: 73 responses completed and one orphan contribution question returned an SSE error. Independent review read all 74 receipts and found an unsafe today-only spending assessment in a complete-data adversarial fixture, two purchase/bill-event routing errors, unknown historical bill origins presented too confidently, an incomplete monthly-income window, an overlapping spending-comparison window, and that orphan contribution error. This was not an all-pass run, even where HTTP requests completed.
- The spending assessment repair separates the displayed forecast date from the future-obligation risk horizon. A fresh $1,000 balance with a $200 cushion and $900 bill tomorrow now yields zero additional safe spending, not $800. It does not change the displayed target-date balance. Independent focused review of the first four repairs passed 73 tests; later repairs and final live evaluation remain pending.

## Candidate and release safeguards

Review v13 SHA: `90dbd1621c31f354b196e12d1bb65acd2b2c754a7c056c6b2a34659a86a6c326`. This repaired candidate passed 269 Edge tests, Deno checking and independent focused review. Its fourteen affected/control live retests finished with twelve relevant responses and two routing failures: generic bill-reserve spending (`timeline_scope`) and extra-debt safety without an amount (`amount_role`). Independent review read all fourteen. Production was again withheld; a shared generic-affordability routing repair and new retests are pending.
All 42 remote runtime files matched the packaged candidate; the local package also includes one type-only source omitted by the runtime.

The user approved a temporary QA allowance for live evaluation using the existing model/provider connection. The allowance is confined to the exact QA user on the review function, expires at 18:00 UTC, and leaves other users, production, minute throttling and usage counters unchanged. It must be removed and clean-package parity verified before production promotion. No customer financial records were changed for these tests.

Production remains v35 while evaluation is pending. Its verified rollback reference is `rollback/prod-before-flo-completion-20260910-1624`, at `6cf9cef6cca65333d7f91e363bcfc4abec428c9c`. The exact production function package has also been retained for rollback.

Final live results, QA-allowance restoration, production version and independent release decision must be recorded below before this document is considered a release receipt.

## Final candidate verification

- Review v14 SHA: `49ceacd7e4908a5fbb14020989fcf7e879b5c19761663a76a3fbf262857b9bf9`. All 42 remote runtime files matched the tested package.
- All 14 final affected/control live retests passed, completed at 17:33:50.674 UTC. Both authenticated saved-conversation follow-ups passed, completed at 17:34:27.677 UTC. SENTINEL independently read all 16 responses and approved their semantic correctness, including honest missing-data outcomes. These are not claims that the entire 74-case corpus was rerun on v14 or that every possible phrasing is guaranteed.
- Final source: 271/271 Edge tests passed, Deno checking passed, user-guide consistency passed. Existing Node module-type warnings are unchanged; they did not fail the checks.
- The temporary QA-only allowance was removed by deploying the clean package to review v15, SHA `5f50966d5c00c887ea9f329164be473bf63eac3841a8b2472a9cdc492d1bed78`. All 42 runtime files exactly match clean source; no QA override remains and JWT verification stays enabled.
- At 17:35:25.937 UTC the QA request received the expected HTTP 429 `usage_limited`, period `day`, confirming normal allowance enforcement. Existing usage counts were not reset. This is an expected safeguard result, not an answer regression.
- The exact production v35 backup and rollback tag remain retained. No customer financial records, schema, provider/model configuration, frontend or PWA artifact changed in this release candidate.

## Remaining data boundaries

Named-account future forecasts, manual-card credit limits, and historical debt-principal/connected-bank balance observations are not invented when the existing schema or retained sources lack them. Manual configured debt APRs remain available through debt queries; aggregate card comparisons require identified card records. Savings-goal earmarks are not added to account balances. Sparse or stale data can legitimately produce an unavailable forecast, affordability amount or goal timeline. These are explicit limitations, not generic fabricated answers.

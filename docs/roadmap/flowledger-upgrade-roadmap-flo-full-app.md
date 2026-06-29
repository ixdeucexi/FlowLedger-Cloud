# FlowLedger Upgrade Roadmap — Flo + Full App

## Summary

FlowLedger should evolve around one core promise: helping users decide whether a money move is safe before it damages the rest of the plan.

Flo becomes the main assistant layer, but deterministic FlowLedger math remains the source of truth. The rest of the app should support that with cleaner setup, better planning, stronger automation, and clearer follow-through.

## Phase 1 — Stability, Trust, and Cleanup

- Keep startup, tab switching, amount updates, calendar, bill edits, snowball, and reconciliation fast and reliable.
- Finish cleanup of duplicated logic between Dashboard, Monthly, Bills, and Transactions so totals match everywhere.
- Add more regression tests for:
  - bill paid/unpaid counts
  - monthly overrides
  - calendar-only transactions
  - debt balance timing
  - under-budget sweeps
  - stale PWA/startup behavior
- Improve save feedback across all edit flows: saving, saved, failed, retry.
- Keep this phase focused on trust, not new features.

## Phase 2 — Flo Upgrade: From Chat to Financial Copilot

Upgrade Flo from simple Q&A into a structured assistant that can answer:

- “Can I afford this?”
- “Why is my balance low?”
- “What bills are left?”
- “What changed since last month?”
- “What should I do with leftover money?”
- “How do I fix this forecast?”

Flo must use verified app facts only for financial answers.

Add Flo response cards for:

- affordability result
- affected dates
- bills causing pressure
- safest alternative amount/date
- next action button

Add “Ask Flo” entry points from Dashboard, Bills, Monthly, Transactions, and More.

Keep AI optional: deterministic answers still work if OpenAI is unavailable.

Flo may explain and recommend, but app confirmation still handles changes.

## Phase 3 — Decision Hub 2.0

Merge the current affordability tools and Flo decision questions into one decision engine.

Support these decision types:

- one-time purchase
- recurring bill
- income change
- payment date change
- savings contribution
- extra debt payment
- bill surplus sweep

Every decision shows:

- safe/caution/unsafe
- lowest projected balance
- affected bills/goals/debts
- safer alternative
- calendar impact
- option to save, apply, postpone, complete, or cancel

Replace scattered decision UI with one clean flow usable from Flo or buttons.

Confirmed decisions should affect forecast exactly once and be reversible.

## Phase 4 — Planning and Budgeting Strength

Add real category budgets and paycheck planning.

Let users assign bills, savings, debt, and spending categories to paychecks.

Show:

- safe-to-spend
- bills covered until next paycheck
- category money left
- upcoming pressure points

Improve Monthly so Bills and Calendar feel like one planning system instead of two separate screens.

Expand under-budget handling:

- send to debt
- send to savings
- keep available
- reduce future bill budget
- cover upcoming bill

## Phase 5 — Accounts, Imports, and Accuracy

Improve account management:

- checking
- savings
- cash
- archived accounts
- reconciliation history

Improve CSV import:

- clearer preview before import
- duplicate review
- category suggestions
- bill matching

Add recurring transaction detection.

Add forecast accuracy reporting:

- projected vs actual
- missed bills
- stale balances
- unusual spending

Keep Plaid out until manual reliability is strong.

## Phase 6 — Reporting and Follow-Through

Add reports that answer useful questions:

- where money went
- why forecast changed
- debt payoff progress
- savings progress
- decision success rate
- monthly cash-flow trend

Add follow-through tracking:

- planned
- applied
- completed
- postponed
- cancelled

Alert users when a saved plan becomes unsafe.

Let Flo summarize reports in plain language.

## Phase 7 — Premium Automation

Add Plaid only after the manual system is stable.

Use Plaid for:

- balance sync
- transaction import
- bill matching
- recurring detection
- forecast refresh

Do not let imported data silently change confirmed decisions.

Add household collaboration after account ownership and privacy rules are solid.

Premium features:

- Plaid
- household sharing
- advanced Flo insights
- long-term decision history
- proactive alerts
- advanced reports

## Flo Rules

- Flo can explain, compare, recommend, and guide.
- Flo cannot invent balances, bills, transactions, or affordability answers.
- Flo cannot directly change data without a normal FlowLedger confirmation.
- Flo should cite the app fact behind financial answers:
  - forecast
  - bill
  - transaction
  - account
  - debt
  - goal
  - decision
- If AI fails, Flo falls back to deterministic app answers.

## Success Measures

- Users can answer “Can I afford this?” in under 30 seconds.
- Forecast and dashboard totals match across the app.
- Startup and tab switching stay fast.
- Amount edits appear immediately.
- Confirmed decisions do not double-count.
- Users complete more decisions without crossing their safety floor.
- Flo answers common finance questions without needing AI.

## Assumptions

- Development continues one phase at a time on dev first.
- No production promotion happens without user testing.
- Current no-lag performance remains a hard requirement.
- FlowLedger remains manual-first until Plaid is justified.
- Flo is the main differentiator, but deterministic calculations stay authoritative.

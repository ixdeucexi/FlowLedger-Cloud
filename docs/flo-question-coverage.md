# Flo question coverage and release evaluation

Source audit: 2026-09-10, following the reported “How long will it take to have 1000 buffer” regression. This is an implementation/evaluation map, **not a passing end-to-end report**. Every natural-language example below is unverified against the current production interpreter unless a separate dated evaluation receipt records otherwise. Calculator unit tests do not establish that a user's sentence reaches that calculator.

Scope: the account, date-specific forecast, affordability, bill, income, spending, debt, savings, budget, buffer, historical progress, scenario and review families requested in this task. This is a finite representative corpus, not a claim to enumerate every possible question or guarantee all answers. No live AI calls or user financial queries were performed for this audit.

Machine-readable evaluation input: [questionCoverage.json](../supabase/functions/flo-chat/questionCoverage.json). Its status distinguishes implemented primitives, missing user data, missing features and semantic routing risks. The JSON adds explicit last-merchant-payment and credit-ranking cases to the grouped matrix below. It is not an execution receipt.

## Immediate wrong-answer risks in the audited baseline (41b7c78)

1. **Goal and amount semantics are not represented.** `analysisPlanner.ts` admits domain/operation combinations with a generic `amount`. `analysisWealth.ts` currently interprets a positive amount as a contribution whenever one savings goal matches. A target such as “have $1000” can become “contribute $1000.” Likewise `savings/plan` can return only current savings instead of a timeline. The reported buffer response is consistent with this route failure; this audit did not inspect its private request trace.
2. **No general completion contract.** `validateAnalysisRequest` validates dates and scenario signs, not whether a timeline, comparison, plan or explanation was actually delivered. A grounded but unrelated balance answer can therefore pass. An explicit-what-if retry exists, but only for that phrasing.
3. **Named debt payoff scope.** Debt details can filter a name, while payoff output is for the entire included plan. Preserve the distinction between one-debt payoff and household debt-free timing; compute the selected debt's payoff from canonical projected months where requested.
4. **Budget plan is historical averages, not an affordable allocation.** Its current label “History-based draft” is honest. Do not describe this as an income-/bill-/minimum-/cushion-constrained budget until those constraints are composed and tested.
5. **Duration completion edge cases.** Buffer calculator has contribution/month estimates, but target already met, zero/negative sustainable surplus, absent history and absent future paycheck each need an explicit timeline outcome. A numeric target must not automatically require the next paycheck to exist.
6. **Last payment and ranking are distinct operations.** “When did I last pay Netflix?” cannot use the default current-month spending window and claim a last-ever result. “Which card has the highest APR/utilization?” cannot use the current first-five credit display without actually ranking all eligible cards. These are feature/intent gaps, not merely missing user history.

Minimal initial repair: explicit purpose and amount role; enforce compatible calculator requests; require purpose-specific result facts/status; use one bounded interpretation correction only where useful; return a narrowly stated missing-input outcome if repair fails. Preserve existing canonical financial engines, provider/model/key configuration and household scope. Do not use a long list of hardcoded question answers.

The working repair introduces purpose/amount-role validation, a bounded interpretation repair, buffer/goal timeline outcomes and a narrower app-navigation predicate. Those changes do not by themselves complete the remaining feature gaps or verify live language-model interpretation. Refer to the final release evidence before treating any repair as shipped.

## Representative family matrix / corpus v1

Code paths below are under `supabase/functions/flo-chat/`. “Available” means source-level calculation exists, not that natural-language routing has passed.

| ID | Representative question | Calculator / required result | Current boundary or gap |
| --- | --- | --- | --- |
| 01 | How much is in Main Checking right now? | `analysisAccounts`: exact account, recorded balance, observation date | Available; active exact name only, no available-funds claim. |
| 02 | How much is in Rainy Day Savings? | `analysisAccounts`, not goal summary | Available if mapped to money/detail; account-vs-goal intent still needs evaluation. |
| 03 | How much can I safely spend today? | `analysisProjection`: safe-to-spend and risk horizon | Conditional on dated funds, posted/pending reconciliation, classified spending baseline and obligations. |
| 04 | What will my balance be September 25? | `analysisProjection`: household end-of-day balance | Available inside configured horizon; actual and estimated spending views must remain distinct. |
| 05 | What will Main Checking have September 25? | Explicit unsupported account-specific projection | Correct explicit limit exists; never substitute household aggregate. |
| 06 | What will be left before my next paycheck? | Event-relative forecast; resolved date | Available; exact income source if named, expected income not guaranteed. |
| 07 | What will remain after Rent is paid? | Event-relative forecast; exact bill and occurrence | Available with unique recorded bill and scheduled event; ambiguous occurrences require care. |
| 08 | What is my lowest and highest balance next month? | Forecast minimum and maximum, dates | Both available; compound request must preserve same window. |
| 09 | When will checking reach $1000? | Forecast threshold crossing date | Available; first crossing is not a sustained protected buffer. Must distinguish ID 25. |
| 10 | Compare the last week of this month with the first week of next month. | Forecast comparison on both windows | Available for future windows; retrospective actual checking uses observations, not rewritten forecast. |
| 11 | Can I afford a $250 purchase? | Purchase affordability and protected low | Available conditionally; must not mistake purchase amount for buffer target. |
| 12 | When is the earliest safe day to buy a $250 appliance? | Purchase-date search with suffix risk minimum | Available conditionally; earliest projected date, not verified future bank funds. |
| 13 | What if I spend $250 this weekend? | Read-only dated purchase delta | Available; do not replace stated timing with an earliest-date search. |
| 14 | What bills are due before payday, and what remains unpaid? | `analysisRecurring` + `analysisSchedule`: occurrence totals and required remainder | Upcoming and earlier-current-month checks available. Entire overdue backlog needs explicit cross-month scope, not an implied complete overdue list. |
| 15 | Did I pay all my bills last month? | Historical monthly payment records plus clear completeness boundary | Existing past-bills path reports payment records, not proof all obligations settled. A complete yes/no reconciliation is not established by that list. |
| 16 | What subscriptions do I have, and which increased? | Recurring/category matches and price changes | Available heuristically; possible patterns, not confirmed active contracts or duplicate services. |
| 17 | How much income did I receive last month? | `analysisSpending` received-income classification | Available; no future scheduled deposits or credit refunds counted as received income. |
| 18 | When and how much is my next paycheck? | `analysisSchedule` expected recurrence and history | Available; month-level income history and excluded-date compatibility must regress. |
| 19 | What is my average monthly income? | Received-income average over stated completed months | Available; recorded history is not proof of full historical coverage. |
| 20 | How much did I spend on groceries / at Walmart last month? | Classified spending, category/merchant filter | Available; transfers/card repayments excluded, refunds netted, uncertain rows disclosed. |
| 21 | Where did spending rise compared with last month? | Spending comparison and category changes | Available; comparison dates must be equal/appropriate periods, not inferred unequal windows. |
| 22 | Find my $35 transaction / unusual charges / fees. | Transaction search, unusual-pattern or fee matching | Available bounded heuristics; no fraud, duplicate-billing or exhaustive-fee claim. |
| 23 | What is my snowball target and required minimum left? | `analysisWealth` + canonical current settlement | Available; current eligible debt, required payments preserved. |
| 24 | When will I be debt-free, and what if I pay $100 extra monthly? | Canonical monthly debt scenario, baseline comparison | Available fixed-payment hypothetical; not verified affordable or exact daily interest. Nonmonthly/missing APR limitations explicit. |
| 25 | How long will it take to have a $1000 buffer? | `analysisStability`: target, remaining, timeline outcome | Reported routing failure. Correct calculator exists; amount must mean target, not contribution. Define buffer above cushion versus total checking explicitly. |
| 26 | How can I get one paycheck / one month ahead? | Buffer target and sustainable contribution scenario | Available conditionally; target and contribution affordability are distinct. Need explicit already-met/no-capacity outcomes. |
| 27 | Am I still living paycheck to paycheck? | `analysisStability`: historical pre-payday observations + income/expense pattern | Available conditionally; sparse closes cannot establish diagnosis. No conclusion from one low balance. |
| 28 | Am I improving over the past three months? | Observed historical lows and cash-flow metrics | Partial: daily checking closes available; complete debt-principal/savings history is not reconstructed from payments. |
| 29 | How much emergency savings do I need for three / six months? | `analysisWealth`: recorded expense baseline and savings coverage | Available estimate; all expenses rather than inferred essentials, earmarked/inaccessible savings not known automatically. |
| 30 | When will Vacation be funded if I save $100 per paycheck? | Named goal, contribution role and cadence, target duration/date | Only contribution count exists in savings branch; cadence/date and affordability require composition. Do not present current savings as complete answer. |
| 31 | Is my credit utilization high, and what payment gets it below 30%? | Connected card balances and credit limits | Available combined/per-card details; missing limits explicit. Credit score predictions are unsupported. |
| 32 | Make a budget that covers bills, debt and saving without overdrafting. | Budget history + expected income + mandatory commitments + cushion | Partial: current budget remaining and history draft exist, constrained allocation does not. |
| 33 | Give me a weekly / monthly financial review. | `analysisReview`: historical spending/income/payments/budget plus separately labeled current outlook | Available composite. Does not fabricate historical debt/savings changes; scope and missing sections explicit. |
| 34 | What if my pay falls $200 / Rent rises $100 / I cancel Streaming? | Scenario delta, amount, occurrence and recurrence | Available delta scenarios. “Rises to” versus “rises by” needs explicit role/resolution; do not invent the baseline or silently use wrong delta. |
| 35 | What if I move Rent from September 15 to September 20? | Named occurrence removal + addition on copy | Available one-off move scenario; real mutation is a separate authorized workflow. |
| 36 | Should I put $100 toward debt or savings? | Two comparable cash scenarios plus debt/buffer consequences | Existing primitives available, but no demonstrated composed recommendation/priority result. Protect minimums/cushion; don't output just balances. |

## Evaluation protocol (not yet executed)

Use fixed fictional fixtures: (A) current dated balances, three completed classified income/expense months, bills, multiple debts and goals; (B) sparse history; (C) missing/stale balance; (D) already-met target; (E) shortfall/no positive surplus; (F) ambiguous same-name entities; (G) linked credit purchases plus checking card repayments/transfers/refunds; (H) valid month-level income history and timestamp exclusion. Keep household/record identities fictional.

For each corpus question record expected purpose/domain, amount role, amount, dates, cadence, entity scope, required result facts, forbidden claims and expected missing-data behavior. Test both:

1. Pure request/calculator contracts with deterministic assertions, including intentionally wrong domain/amount-role requests rejected before execution.
2. Question -> actual interpreter -> validated plan -> calculator -> final text, using the existing authorized provider configuration and permitted evaluation budget. Capture plan and result facts in a privacy-safe receipt; assert semantic completion, not merely HTTP success, nonempty text or absence of invented numbers.

First regression set: ID 25 verbatim, “When can I build a $1,000 cushion?”, “How many paychecks until I have a thousand-dollar buffer?”, then contrasting “What is my buffer now?”, “When does checking first reach $1000?”, “How long to save $1000 for Vacation?”, “I can contribute $100 per paycheck,” and “What if I spend $1000?” Include already-met and insufficient-data fixtures. Do not conflate these purposes.

Existing `analysis*.test.mjs` mostly constructs typed requests directly. Those tests are necessary for arithmetic and integrity but do not prove interpreter routing. A live QA account's exhausted daily cap must not be bypassed or silently reset; stage permitted evaluation separately or record it as unexecuted.

Release claim must identify which corpus cases actually passed, which have an explicit honest data limitation, and which remain unsupported. Do not claim “all kinds of questions,” “entire list verified,” or completion of the full financial-coaching specification based on this source audit.

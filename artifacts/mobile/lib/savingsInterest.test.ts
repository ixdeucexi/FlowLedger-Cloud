import assert from "node:assert/strict";
import test from "node:test";
import type { ForecastAccountRef } from "./accountForecasts";
import type { FinancialEvent } from "./forecast";
import { savingsInterestCredits, validateSavingsApy } from "./savingsInterest";

const savings = "manual:family-savings" as ForecastAccountRef;
const base = {
  openingPostedBalance: 1_000,
  apy: 5,
  asOfDate: "2026-12-31",
  endDate: "2027-12-31",
  events: [] as FinancialEvent[],
  accountRef: savings,
};
const total = (events: readonly FinancialEvent[]) => Math.round(events.reduce((sum, event) => sum + event.amount, 0) * 100) / 100;
const cents = (value: number) => Math.round(value * 100) / 100;
const cash = (date: string, amount: number, extra: Partial<FinancialEvent> = {}): FinancialEvent => ({
  id: `cash:${date}:${amount}`,
  sourceType: "transaction",
  sourceId: `transaction:${date}:${amount}`,
  date,
  kind: amount >= 0 ? "transaction_income" : "transaction_expense",
  amount,
  status: "scheduled",
  accountRef: savings,
  ...extra,
});

test("Savings APY is optional, preserves explicit zero, and rejects invalid rates", () => {
  for (const value of [undefined, null, "", " ", "\t"]) assert.equal(validateSavingsApy(value), null);
  for (const value of [0, "0", "0.00"]) assert.equal(validateSavingsApy(value), 0);
  assert.equal(validateSavingsApy("4.25"), 4.25);
  assert.equal(validateSavingsApy(" 4.25 "), 4.25);
  assert.equal(validateSavingsApy(100), 100);
  for (const value of [-0.001, 100.001, Number.NaN, Infinity, -Infinity, "5%", "Infinity", "0x10", {}, [], true, false]) {
    assert.throws(() => validateSavingsApy(value), /APY between 0% and 100%/);
  }
});

test("unset and zero APY never fabricate an interest event", () => {
  assert.deepEqual(savingsInterestCredits({ ...base, apy: null }), []);
  assert.deepEqual(savingsInterestCredits({ ...base, apy: 0 }), []);
  assert.deepEqual(savingsInterestCredits({ ...base, endDate: base.asOfDate }), []);
});

test("full calendar years earn the effective annual yield, including leap and century years", () => {
  for (const year of [2027, 2028, 2000, 2100]) {
    for (const apy of [0.01, 0.1, 1, 5, 12, 100]) {
      const events = savingsInterestCredits({ ...base, apy, asOfDate: `${year - 1}-12-31`, endDate: `${year}-12-31` });
      assert.equal(total(events), cents(1_000 * apy / 100), `${year}, APY ${apy}`);
      assert(events.every(event => event.date.startsWith(String(year))));
      assert(events.every(event => event.amount > 0 && Math.abs(event.amount * 100 - Math.round(event.amount * 100)) < 1e-8));
    }
  }
});

test("uncredited accrual compounds and month-end rounding retains fractional cents", () => {
  const january = savingsInterestCredits({ ...base, endDate: "2027-01-31" });
  const expected = cents(1_000 * Math.expm1(Math.log1p(0.05) * 31 / 365));
  assert.equal(january.length, 1);
  assert.equal(january[0].amount, expected);

  const tiny = savingsInterestCredits({ ...base, openingPostedBalance: 10, apy: 0.1 });
  assert.equal(total(tiny), 0.01, "fractions below half a cent must survive earlier month ends");
  assert(tiny.every(event => event.amount === 0.01));
  assert.equal(total(savingsInterestCredits({ ...base, openingPostedBalance: 1, apy: 5 })), 0.05);
});

test("interest starts after the observed balance date and becomes cash only at month end", () => {
  const oneDay = savingsInterestCredits({ ...base, asOfDate: "2027-01-30", endDate: "2027-01-31" });
  assert.equal(total(oneDay), cents(1_000 * Math.expm1(Math.log1p(0.05) / 365)));
  const partial = savingsInterestCredits({ ...base, asOfDate: "2027-01-15", endDate: "2027-01-31" });
  assert.equal(total(partial), cents(1_000 * Math.expm1(Math.log1p(0.05) * 16 / 365)));
  assert.deepEqual(savingsInterestCredits({ ...base, asOfDate: "2027-01-15", endDate: "2027-01-30" }), []);

  const pastAndAnchorActivity = [cash("2026-12-01", 50_000), cash("2026-12-31", -900), cash("2028-01-01", 100_000)];
  assert.deepEqual(savingsInterestCredits({ ...base, events: pastAndAnchorActivity }), savingsInterestCredits(base));
});

test("dated deposits and withdrawals use posted principal, with an independently calculated final value", () => {
  const depositDate = "2027-04-01";
  const withdrawalDate = "2027-09-01";
  const events = [cash(depositDate, 500), cash(withdrawalDate, -300)];
  const inclusiveDays = (date: string) => (Date.parse(`${base.endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000 + 1;
  const expectedFinal = 1_000 * 1.05
    + 500 * Math.pow(1.05, inclusiveDays(depositDate) / 365)
    - 300 * Math.pow(1.05, inclusiveDays(withdrawalDate) / 365);
  const expectedInterest = cents(expectedFinal - 1_200);
  assert.equal(total(savingsInterestCredits({ ...base, events })), expectedInterest);
  assert.deepEqual(savingsInterestCredits({ ...base, events }), savingsInterestCredits({ ...base, events: [...events].reverse() }));
});

test("cash-flow scenarios conserve cents against closed-form annual future values", () => {
  for (const year of [2027, 2028]) {
    const daysInYear = year === 2028 ? 366 : 365;
    const endDate = `${year}-12-31`;
    for (const opening of [1.23, 1_234.56, 1_000_000]) {
      const events = [
        cash(`${year}-01-15`, cents(opening * 0.25)),
        cash(`${year}-06-01`, -cents(opening * 0.1)),
        cash(`${year}-11-25`, cents(opening * 0.05)),
      ];
      const cashNet = events.reduce((sum, event) => sum + event.amount, 0);
      for (const apy of [0.0001, 0.05, 4.5, 12]) {
        const futureValue = opening * (1 + apy / 100) + events.reduce((sum, event) => {
          const remainingDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / 86_400_000 + 1;
          return sum + event.amount * Math.pow(1 + apy / 100, remainingDays / daysInYear);
        }, 0);
        const credits = savingsInterestCredits({ ...base, openingPostedBalance: opening, apy, asOfDate: `${year - 1}-12-31`, endDate, events });
        assert.equal(total(credits), cents(futureValue - opening - cashNet), `${year}, principal ${opening}, APY ${apy}`);
      }
    }
  }
});

test("zero or negative posted balances earn no additional interest until a future deposit", () => {
  assert.deepEqual(savingsInterestCredits({ ...base, openingPostedBalance: 0 }), []);
  assert.deepEqual(savingsInterestCredits({ ...base, openingPostedBalance: -100 }), []);
  const restored = savingsInterestCredits({ ...base, openingPostedBalance: -100, events: [cash("2027-12-01", 1_100)] });
  assert.equal(total(restored), cents(1_000 * Math.expm1(Math.log1p(0.05) * 31 / 365)));

  const drained = savingsInterestCredits({ ...base, endDate: "2027-02-28", events: [cash("2027-01-16", -1_000)] });
  assert.equal(total(drained), cents(1_000 * Math.expm1(Math.log1p(0.05) * 15 / 365)), "do not compound uncredited interest alone while posted principal is zero");
});

test("pending available-balance holds are not an interest-bearing principal change", () => {
  const pending = [cash("2027-01-01", -900, { status: "pending" }), cash("2027-06-01", 5_000, { status: "pending" })];
  assert.deepEqual(savingsInterestCredits({ ...base, events: pending }), savingsInterestCredits(base));
  assert(total(savingsInterestCredits({ ...base, events: [cash("2027-01-01", -900)] })) < total(savingsInterestCredits(base)));
});

test("recalculation ignores old virtual credits and never mutates inputs or combines accounts", () => {
  const input = Object.freeze({ ...base, events: Object.freeze([Object.freeze(cash("2027-07-01", 200))]) });
  const original = JSON.stringify(input);
  const events = savingsInterestCredits(input);
  assert.equal(JSON.stringify(input), original);
  assert.deepEqual(savingsInterestCredits({ ...input, events: [...input.events, ...events] }), events);
  assert(total(savingsInterestCredits({ ...input, apy: 6 })) > total(events));

  const other = "bank:11111111-1111-4111-8111-111111111111" as ForecastAccountRef;
  const separate = savingsInterestCredits({ ...base, accountRef: other, openingPostedBalance: 2_000 });
  assert.equal(total(separate), 100);
  assert(events.every(event => event.sourceId === savings && event.accountRef === savings));
  assert(separate.every(event => event.sourceId === other && event.accountRef === other));
  assert.notEqual(events[0].id, separate[0].id);
});

test("estimated credits are future, positive, virtual, and dated on actual calendar month ends", () => {
  const events = savingsInterestCredits({ ...base, asOfDate: "2028-01-15", endDate: "2028-03-31" });
  assert.deepEqual(events.map(event => event.date), ["2028-01-31", "2028-02-29", "2028-03-31"]);
  for (const event of events) {
    assert.equal(event.kind, "estimated_interest");
    assert.equal(event.sourceType, "account");
    assert.equal(event.estimated, true);
    assert.equal(event.status, "planned");
    assert.equal(event.name, "Estimated interest");
    assert(event.amount > 0);
    assert(event.date > "2028-01-15");
  }
});

test("invalid dates, ranges, principal and cash amounts fail explicitly", () => {
  for (const date of ["2027-02-29", "2028-02-30", "2027-04-31", "2027-13-01", "2027-00-01", "2027-01-00", "2027-1-01", "0000-01-01", "not-a-date"]) {
    assert.throws(() => savingsInterestCredits({ ...base, asOfDate: date }), /valid savings forecast date/);
    assert.throws(() => savingsInterestCredits({ ...base, endDate: date }), /valid savings forecast date/);
  }
  assert.throws(() => savingsInterestCredits({ ...base, endDate: "2026-12-30" }), /on or after/);
  assert.throws(() => savingsInterestCredits({ ...base, endDate: "9999-12-31" }), /within the next 100 years/);
  for (const balance of [NaN, Infinity, -Infinity]) assert.throws(() => savingsInterestCredits({ ...base, openingPostedBalance: balance }), /verified posted balance/);
  for (const amount of [NaN, Infinity, -Infinity]) assert.throws(() => savingsInterestCredits({ ...base, events: [cash("2027-01-15", amount)] }), /valid amounts/);
  assert.throws(() => savingsInterestCredits({ ...base, events: [cash("2027-02-31", 100)] }), /valid savings forecast date/);
  assert.throws(() => savingsInterestCredits({ ...base, openingPostedBalance: 1.7e308, events: [cash("2027-01-01", 1.7e308)] }), /supported amount range/);
});

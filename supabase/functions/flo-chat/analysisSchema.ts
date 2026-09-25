import { z } from "npm:zod@4.4.3";
import { jsonSchema } from "npm:ai@7.0.59";
import type { AnalysisPlan } from "./analysisSemantics.ts";
import type { AnalysisRequest } from "./analysisTypes.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const search = z.string().max(100).nullable();
const domain = z.enum(["money", "forecast", "purchase", "spending", "bills", "subscriptions", "income", "debt", "credit", "savings", "emergency", "budget", "stability", "buffer", "paycheck", "progress", "transactions", "unusual", "fees", "health", "review"]);
const operation = z.enum(["summary", "detail", "compare", "minimum", "maximum", "threshold", "plan", "scenario", "search", "average"]);
const entity = search.describe("Exact named bill, debt, goal, account, or income source. For a balance before/after a named paycheck, use that income source with dateEvent before_payday/after_payday; it selects an event, not an account forecast. Never invent a record name or use a numeric amount as its name.");
const scenario = z.object({
  kind: z.enum(["purchase", "income_change", "extra_debt", "save", "bill_increase", "cancel_bill", "move_bill"]),
  amount: z.number().min(-1e9).max(1e9),
  amountMode: z.enum(["delta", "absolute"]).nullable().describe("bill_increase only: rises BY an amount uses delta; rises TO a new bill amount uses absolute. Do not calculate the difference yourself. Other kinds use null."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceDate: date.describe("For moving a bill, original occurrence date if specified; destination is date. Null otherwise, especially for an ongoing price change or cancellation so all scheduled occurrences remain in scope."),
  entity: search,
  repeat: z.enum(["once", "monthly", "paycheck"]).describe("Preserve stated repetition. Ordinary bill price changes and full cancellation use monthly to affect all existing scheduled occurrences. Explicit once/next payment/this month only uses once. Other unstated hypothetical changes default once."),
}).strict();
const hypothetical = scenario.nullable().describe("Explicit what-if only, never a real-data change. income_change is a signed delta. Preserve stated frequency; default once. A recurring source does not imply the hypothetical repeats.");

/** Compact wire contract: only dispatch/scope fields repeat in the purpose union.
 * The shared financial parameters occur once, avoiding fifteen copies of the
 * full schema in every provider call. No defaults or transforms guess scope. */
const calculation = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("general"), domain, operation, entity, scenario: hypothetical }).strict(),
  z.object({ purpose: z.literal("current_balance"), domain: z.literal("money"), operation: z.literal("detail"), entity, scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("forecast_balance"), domain: z.literal("forecast"), operation: z.enum(["summary", "detail", "compare", "minimum", "maximum", "threshold", "scenario"]), entity, scenario: hypothetical }).strict(),
  z.discriminatedUnion("domain", [
    z.object({ purpose: z.literal("affordability"), domain: z.literal("money"), operation: z.enum(["summary", "detail", "scenario"]), entity, scenario: hypothetical }).strict(),
    z.discriminatedUnion("operation", [
      z.object({ purpose: z.literal("affordability"), domain: z.literal("purchase"), operation: z.literal("plan"), entity, scenario: z.null().describe("Earliest/safest purchase-date search uses parameters.amount, never an invented purchase-today scenario.") }).strict(),
      z.object({ purpose: z.literal("affordability"), domain: z.literal("purchase"), operation: z.enum(["summary", "detail", "scenario"]), entity, scenario: hypothetical }).strict(),
    ]),
  ]),
  z.object({ purpose: z.literal("buffer_timeline").describe("Only how long/when to reach a future cash-buffer target. Current buffer/cushion now uses general/buffer/summary with no invented target or contribution; it is not a timeline."), domain: z.literal("buffer"), operation: z.literal("plan"), entity: z.null(), scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("goal_timeline"), domain: z.literal("savings"), operation: z.literal("plan"), entity, scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("debt_timeline"), domain: z.literal("debt"), operation: z.enum(["plan", "scenario"]), entity, scenario: scenario.extend({ kind: z.literal("extra_debt"), amount: z.number().min(0).max(1e9), amountMode: z.null() }).nullable() }).strict(),
  z.object({ purpose: z.literal("paycheck_allocation"), domain: z.literal("paycheck"), operation: z.literal("plan"), entity: z.null(), scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("action_plan").describe("An explicitly requested action checklist or improvement plan. Assessing current financial health or biggest risks uses general/health/summary, not a one-day action plan."), domain: z.literal("stability"), operation: z.literal("plan"), entity: z.null(), scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("budget_plan"), domain: z.literal("budget"), operation: z.literal("plan"), entity: z.null(), scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("allocation_choice"), domain: z.literal("stability"), operation: z.literal("plan"), entity: z.null(), scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("transaction_last"), domain: z.literal("transactions"), operation: z.literal("detail"), entity, scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("balance_history").describe("Only explicitly historical account/debt balance observations or changes. Current required minimum payments remaining uses general/debt/summary, never balance_history; payments are obligations, not principal history."), domain: z.enum(["money", "savings", "debt", "credit", "progress"]), operation: z.enum(["summary", "detail", "compare", "minimum", "maximum"]), entity, scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("bill_settlement"), domain: z.literal("bills"), operation: z.enum(["summary", "detail"]), entity, scenario: z.null() }).strict(),
  z.object({ purpose: z.literal("bills_overdue"), domain: z.literal("bills"), operation: z.enum(["summary", "detail"]), entity, scenario: z.null() }).strict(),
]);

const parameters = z.object({
  planDays: z.union([z.literal(30), z.literal(90)]).nullable(),
  timelineUnit: z.enum(["months", "household_paydays"]).nullable().describe("Requested duration unit for buffer/goal timing: number of paychecks uses household_paydays, months uses months, otherwise null. This does not supply a contribution amount."),
  metric: z.enum(["balance", "apr", "utilization", "amount"]).nullable().describe("Preserve the requested ranking metric. Never substitute balance for APR."),
  amountRole: z.enum(["none", "target_balance", "contribution_amount", "payment_amount", "purchase_amount", "threshold"]),
  contribution: z.object({ amount: z.number().positive().max(1e9), frequency: z.enum(["once", "monthly", "paycheck"]) }).strict().nullable().describe("Only a separately stated savings contribution and its explicit frequency; never derive from target amount."),
  accountGroup: z.enum(["checking", "savings", "all"]).nullable().describe("Current balance scope only: checking/cash, savings, or both (all). Null for an exact named account or other purposes. Never answer savings with checking."),
  groupBy: z.enum(["category", "merchant", "none"]),
  incomeTiming: z.enum(["received", "expected"]),
  startDate: date.describe("Explicit requested start in household local calendar, otherwise null. Resolve this week/weekend/year and relative periods; do not default every question to this month."),
  endDate: date.describe("Requested end/date, otherwise null. Resolve next Friday, first of next month and days/weeks from now against the supplied local today."),
  dateEvent: z.enum(["none", "next_payday", "before_payday", "after_payday", "after_bill"]),
  merchant: search,
  category: search.describe("Use the matching recorded category label from the catalog, including ordinary singular/plural wording (grocery may refer to Groceries). Do not substitute a different category."),
  amount: z.number().min(0).max(1e9).nullable().describe("Only an explicit user-provided currency amount/threshold, not a computed number or an example amount."),
  comparisonStart: date,
  comparisonEnd: date,
  target: z.enum(["none", "paycheck_ahead", "month_ahead", "three_months", "six_months"]),
  debtMethod: z.enum(["snowball", "avalanche"]),
}).strict();

export const financialAnalysisSchema = z.object({
  legacy: z.boolean().describe("True only for app navigation/how-to, saved-plan retrieval, connection help, explicit real-data changes, or unrelated questions. Actual financial analysis is false."),
  requests: z.array(z.object({
    calculation: calculation.describe("Select a coherent calculator purpose, domain, operation and scope. Household-only plans require entity null. Named income cutoff forecasts use forecast_balance, not paycheck_allocation."),
    parameters: parameters.describe("Financial question parameters for this calculation. Unspecified optional values are null; never invent financial data."),
  }).strict()).max(4),
}).strict();

// Zod emits oneOf for a discriminated union; OpenAI structured output uses
// nested anyOf. These alternatives are mutually exclusive by their literal
// purpose/domain discriminators, so conversion preserves their accepted set.
export const financialAnalysisJsonSchema = z.toJSONSchema(financialAnalysisSchema, {
  target: "draft-7",
  override: ({ jsonSchema: node }) => {
    if (node.oneOf) { node.anyOf = node.oneOf; delete node.oneOf; }
  },
});
export const financialAnalysisProviderSchema = jsonSchema<z.infer<typeof financialAnalysisSchema>>(financialAnalysisJsonSchema, {
  validate: value => {
    const result = financialAnalysisSchema.safeParse(value);
    return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
  },
});

/** Flatten only after the complete wire object is validated. No coercion,
 * dropping a named scope, or fixing an incompatible calculator behind the user. */
export function parseFinancialAnalysisPlan(output: unknown): AnalysisPlan {
  const parsed = financialAnalysisSchema.parse(output);
  const requests: AnalysisRequest[] = parsed.requests.map(({ calculation, parameters }) => ({ ...parameters, ...calculation }));
  return { legacy: parsed.legacy, requests };
}

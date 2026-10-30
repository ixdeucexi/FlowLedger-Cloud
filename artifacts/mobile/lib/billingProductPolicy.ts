import { PLAN_CATALOG, PRO_INTRO_ANNUAL_PRICE } from "./membership";

export type BillingCadence = "monthly" | "annual";
export interface BillingQuote {
  cadence: BillingCadence;
  price: number;
  priceString: string;
  currencyCode: string;
  introductory?: {
    price: number;
    priceString: string;
    renewalPriceString: string;
  };
}
export interface StorePriceFacts {
  identifier: string;
  price: number;
  priceString: string;
  currencyCode: string;
  subscriptionPeriod: string | null;
  subscription: boolean;
}
export interface StoreIntroFacts {
  price: number;
  priceString: string;
  period: string;
  cycles: number;
  eligible: boolean;
}
export function billingCadenceForProduct(productId: string): BillingCadence {
  if (
    ["flowledger_pro_monthly", "flowledger_pro:monthly-autorenewing"].includes(
      productId,
    )
  )
    return "monthly";
  if (
    ["flowledger_pro_annual", "flowledger_pro:annual-autorenewing"].includes(
      productId,
    )
  )
    return "annual";
  throw new Error(
    "This store product is not an approved FlowLedger subscription.",
  );
}
export function verifiedBillingQuote(
  product: StorePriceFacts,
  expectedId: string,
  intro?: StoreIntroFacts,
): BillingQuote {
  const cadence = billingCadenceForProduct(expectedId);
  const period = cadence === "annual" ? "P1Y" : "P1M";
  if (
    product.identifier !== expectedId ||
    !product.subscription ||
    product.subscriptionPeriod !== period ||
    !Number.isFinite(product.price) ||
    product.price <= 0 ||
    !product.priceString.trim() ||
    !/^[A-Z]{3}$/.test(product.currencyCode)
  ) {
    throw new Error(
      "The store subscription details could not be verified. Please try again later.",
    );
  }
  const expected =
    cadence === "annual"
      ? PLAN_CATALOG.pro.annualPrice
      : PLAN_CATALOG.pro.monthlyPrice;
  if (
    product.currencyCode === "USD" &&
    Math.round(product.price * 100) !== Math.round(expected * 100)
  ) {
    throw new Error(
      "The store price is not ready for this Pro plan yet. No purchase was started.",
    );
  }
  const quote: BillingQuote = {
    cadence,
    price: product.price,
    priceString: product.priceString,
    currencyCode: product.currencyCode,
  };
  if (
    intro?.eligible &&
    cadence === "annual" &&
    intro.period === "P1Y" &&
    intro.cycles === 1 &&
    Number.isFinite(intro.price) &&
    intro.price > 0 &&
    intro.price < product.price &&
    intro.priceString.trim() &&
    (product.currencyCode !== "USD" ||
      Math.round(intro.price * 100) ===
        Math.round(PRO_INTRO_ANNUAL_PRICE * 100))
  ) {
    quote.introductory = {
      price: intro.price,
      priceString: intro.priceString,
      renewalPriceString: product.priceString,
    };
  }
  return quote;
}
export function billingQuoteDisclosure(quote: BillingQuote): string {
  if (quote.introductory)
    return `${quote.introductory.priceString} for the first year, then ${quote.priceString} per year. Renews automatically until cancelled. No free trial.`;
  return `${quote.priceString} per ${quote.cadence === "annual" ? "year" : "month"}. Renews automatically until cancelled. No free trial.`;
}

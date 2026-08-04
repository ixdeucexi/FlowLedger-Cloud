const { CreditAccountSubtype, Products } = require("./plaid");

const LINK_INTENTS = Object.freeze({
  bank: "bank",
  creditCard: "credit_card",
});

function normalizeLinkIntent(value) {
  if (value == null || String(value).trim() === "") return LINK_INTENTS.bank;
  const normalized = String(value).trim().toLowerCase();
  return Object.values(LINK_INTENTS).includes(normalized) ? normalized : null;
}

const HOSTED_LINK_LIFETIME_SECONDS = 30 * 60;

function buildLinkTokenRequest({ userId, config, intent, hosted = false }) {
  const request = {
    user: { client_user_id: userId },
    client_name: "FlowLedger",
    products: [Products.Transactions],
    additional_consented_products: [Products.Liabilities],
    country_codes: ["US"],
    language: "en",
    transactions: { days_requested: 90 },
  };

  if (intent === LINK_INTENTS.creditCard) {
    request.account_filters = {
      credit: { account_subtypes: [CreditAccountSubtype.All] },
    };
  }
  if (config.webhookUrl) request.webhook = config.webhookUrl;
  if (config.redirectUri) request.redirect_uri = config.redirectUri;
  if (hosted) {
    if (!config.redirectUri) {
      const error = new Error("PLAID_REDIRECT_URI is required for mobile credit-card linking.");
      error.code = "PLAID_REDIRECT_URI_MISSING";
      throw error;
    }
    request.hosted_link = {
      completion_redirect_uri: config.redirectUri,
      is_mobile_app: false,
      url_lifetime_seconds: HOSTED_LINK_LIFETIME_SECONDS,
    };
  }
  return request;
}

module.exports = { buildLinkTokenRequest, HOSTED_LINK_LIFETIME_SECONDS, LINK_INTENTS, normalizeLinkIntent };

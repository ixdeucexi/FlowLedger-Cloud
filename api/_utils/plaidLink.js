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

function buildLinkTokenRequest({ userId, config, intent }) {
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
  return request;
}

module.exports = { buildLinkTokenRequest, LINK_INTENTS, normalizeLinkIntent };

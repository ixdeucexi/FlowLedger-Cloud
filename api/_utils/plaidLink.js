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
const PLAID_ANDROID_PACKAGE = "com.flowledger.app";
const LINK_PLATFORMS = new Set(["web", "ios", "android"]);

function normalizeLinkPlatform(value) {
  if (value == null || String(value).trim() === "") return "web";
  const normalized = String(value).trim().toLowerCase();
  return LINK_PLATFORMS.has(normalized) ? normalized : null;
}

function buildLinkTokenRequest({ userId, config, intent, platform = "web", hosted = false, accessToken = null }) {
  const request = {
    user: { client_user_id: userId },
    client_name: "FlowLedger",
    country_codes: ["US"],
    language: "en",
  };

  if (accessToken) {
    request.access_token = accessToken;
  } else {
    request.products = [Products.Transactions];
    request.additional_consented_products = [Products.Liabilities];
    request.transactions = { days_requested: 90 };
  }

  if (!accessToken && intent === LINK_INTENTS.creditCard) {
    request.account_filters = {
      credit: { account_subtypes: [CreditAccountSubtype.All] },
    };
  }
  if (config.webhookUrl) request.webhook = config.webhookUrl;
  if (platform === "android") request.android_package_name = PLAID_ANDROID_PACKAGE;
  else if (config.redirectUri) request.redirect_uri = config.redirectUri;
  if (hosted) {
    if (platform !== "web") {
      const error = new Error("Hosted Link is only available to the web client.");
      error.code = "PLAID_HOSTED_PLATFORM_INVALID";
      throw error;
    }
    if (!config.redirectUri) {
      const error = new Error("PLAID_REDIRECT_URI is required for mobile account linking.");
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

module.exports = { buildLinkTokenRequest, HOSTED_LINK_LIFETIME_SECONDS, LINK_INTENTS, normalizeLinkIntent, normalizeLinkPlatform, PLAID_ANDROID_PACKAGE };

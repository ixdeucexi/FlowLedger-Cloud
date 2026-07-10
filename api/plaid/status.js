const {
  encryptionConfigured,
  plaidConfigured,
  plaidEnv,
  sendJson,
  supabaseConfigured,
} = require("../_utils/plaid");

function validateRedirectUri() {
  const env = plaidEnv();
  const redirectUri = process.env.PLAID_REDIRECT_URI;

  if (!redirectUri) {
    return env === "production"
      ? {
          ready: false,
          message: "Add PLAID_REDIRECT_URI in Vercel Production before bank linking can open Plaid OAuth.",
          missing: ["PLAID_REDIRECT_URI"],
        }
      : { ready: true, message: null, missing: [] };
  }

  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:") {
      return {
        ready: false,
        message: "PLAID_REDIRECT_URI must be an HTTPS URL.",
        missing: ["PLAID_REDIRECT_URI"],
      };
    }
    if (parsed.hash) {
      return {
        ready: false,
        message: "PLAID_REDIRECT_URI cannot include a URL fragment.",
        missing: ["PLAID_REDIRECT_URI"],
      };
    }
    return { ready: true, message: null, missing: [] };
  } catch {
    return {
      ready: false,
      message: "PLAID_REDIRECT_URI must be a valid HTTPS URL registered in Plaid.",
      missing: ["PLAID_REDIRECT_URI"],
    };
  }
}

module.exports = async function handler(_req, res) {
  const plaidReady = plaidConfigured();
  const redirect = validateRedirectUri();
  const linkReady = plaidReady && redirect.ready;
  const storageReady = supabaseConfigured() && encryptionConfigured();

  return sendJson(res, 200, {
    configured: linkReady,
    storageReady,
    environment: plaidEnv(),
    missing: redirect.missing,
    message: linkReady
      ? storageReady
        ? "Bank sync is ready for secure account linking."
        : "Plaid is configured. Add Supabase service and token encryption env vars before storing linked accounts."
      : redirect.message || "Add Plaid client ID and secret in Vercel to enable bank sync.",
  });
};

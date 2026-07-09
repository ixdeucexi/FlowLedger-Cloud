const {
  encryptionConfigured,
  plaidConfigured,
  plaidEnv,
  sendJson,
  supabaseConfigured,
} = require("../_utils/plaid");

module.exports = async function handler(_req, res) {
  const plaidReady = plaidConfigured();
  const storageReady = supabaseConfigured() && encryptionConfigured();

  return sendJson(res, 200, {
    configured: plaidReady,
    storageReady,
    environment: plaidEnv(),
    message: plaidReady
      ? storageReady
        ? "Bank sync is ready for secure account linking."
        : "Plaid is configured. Add Supabase service and token encryption env vars before storing linked accounts."
      : "Add Plaid client ID and secret in Vercel to enable bank sync.",
  });
};

const { plaid } = require("../_utils/plaid");
const { authenticatedUser, publicError } = require("../_utils/supabase");
const { PlaidItemConflictError } = require("../_utils/plaidItemStore");
const { connectPlaidPublicToken } = require("../_utils/plaidConnect");
const { hostedLinkCompletion, validateHostedLinkSession } = require("../_utils/plaidHostedLink");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

function aggregateConnections(results) {
  return {
    ok: true,
    item_id: results[0]?.item_id || null,
    institution_name: results[0]?.institution_name || "Connected bank",
    status: results.every(result => result.already_connected) ? "already_connected" : "connected",
    already_connected: results.every(result => result.already_connected),
    accounts_count: results.reduce((total, result) => total + Number(result.accounts_count || 0), 0),
    credit_cards_count: results.reduce((total, result) => total + Number(result.credit_cards_count || 0), 0),
    credit_card_debts_count: results.reduce((total, result) => total + Number(result.credit_card_debts_count || 0), 0),
    liability_details_available: results.some(result => result.liability_details_available),
    transactions_count: results.reduce((total, result) => total + Number(result.transactions_count || 0), 0),
    transactions_pending: results.some(result => result.transactions_pending),
  };
}

module.exports = async function exchangePublicToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  const input = body(req);
  const publicToken = String(input.public_token || "").trim();
  const hostedSession = String(input.hosted_session || "").trim();
  if ((!publicToken && !hostedSession) || (publicToken && hostedSession)) {
    return res.status(400).json({ error: "PUBLIC_TOKEN_INVALID", message: "Plaid did not return a valid connection token." });
  }
  if (publicToken.length > 512 || hostedSession.length > 4096) {
    return res.status(400).json({ error: "PUBLIC_TOKEN_INVALID", message: "Plaid did not return a valid connection token." });
  }
  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });

    let publicTokens = publicToken ? [publicToken] : [];
    if (hostedSession) {
      const session = validateHostedLinkSession(hostedSession, { userId: auth.user.id, householdId: access.householdId });
      const linkData = (await plaid().linkTokenGet({ link_token: session.linkToken })).data;
      const completion = hostedLinkCompletion(linkData);
      if (completion.status === "pending") {
        return res.status(202).json({ ok: false, status: "pending", message: "Plaid is finishing the secure connection." });
      }
      if (completion.status === "exited") {
        return res.status(409).json({ error: "PLAID_LINK_EXITED", message: "Card connection was not completed. Please try again." });
      }
      publicTokens = completion.publicTokens;
    }

    const results = [];
    for (const token of publicTokens) {
      results.push(await connectPlaidPublicToken({ publicToken: token, userId: auth.user.id, householdId: access.householdId }));
    }
    return res.status(200).json(aggregateConnections(results));
  } catch (error) {
    if (error instanceof PlaidItemConflictError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    const code = error && error.response && error.response.data && error.response.data.error_code || error.code || "PUBLIC_TOKEN_EXCHANGE_FAILED";
    const status = code === "PLAID_LINK_SESSION_INVALID" ? 400 : 500;
    return res.status(status).json({ error: code, message: publicError(error, "Could not finish connecting this bank.") });
  }
};

module.exports.aggregateConnections = aggregateConnections;

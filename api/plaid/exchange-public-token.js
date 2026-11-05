const { plaid } = require("../_utils/plaid");
const { authenticatedUser, serviceSupabase, publicError } = require("../_utils/supabase");
const { PlaidItemConflictError } = require("../_utils/plaidItemStore");
const { connectPlaidPublicToken } = require("../_utils/plaidConnect");
const { hostedLinkCompletion, validateHostedLinkSession } = require("../_utils/plaidHostedLink");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");
const { plaidAccountIdentity } = require("../_utils/sync");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

function invalidCompletion() {
  const error = new Error("The saved bank connection could not be verified. Please check its connection status.");
  error.code = "PLAID_CONNECTION_UNVERIFIED";
  return error;
}

const COUNT_FIELDS = ["accounts_count", "credit_cards_count", "credit_card_debts_count", "transactions_count", "subscriptions_count"];

function validateConnectionResult(result, requireSaved = false) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.ok === false
    || typeof result.item_id !== "string" || !result.item_id.trim() || result.item_id.length > 128
    || (requireSaved && result.connection_saved !== true)) throw invalidCompletion();
  if (result.item_ids !== undefined && (!Array.isArray(result.item_ids) || !result.item_ids.includes(result.item_id)
    || result.item_ids.some(id => typeof id !== "string" || !id.trim() || id.length > 128))) throw invalidCompletion();
  for (const field of COUNT_FIELDS) {
    const count = field === "accounts_count" ? result[field] : result[field] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw invalidCompletion();
  }
}

async function verifyCanonicalConnection(result, { client, userId, householdId, savedItem }) {
  const identityColumns = "id,plaid_item_record_id,persistent_account_id,name,official_name,mask,type,subtype,account_type,account_subtype,is_active";
  const [retired, accounts, items] = await Promise.all([
    client.from("plaid_accounts").select(identityColumns).eq("user_id", userId).eq("household_id", householdId)
      .eq("plaid_item_record_id", savedItem.id),
    client.from("plaid_accounts").select(identityColumns).eq("user_id", userId).eq("household_id", householdId)
      .eq("is_active", true),
    client.from("plaid_items").select("id,institution_id,institution_name").eq("user_id", userId)
      .eq("household_id", householdId).in("status", ["active", "needs_repair"]),
  ]);
  if (retired.error || accounts.error || items.error || !retired.data?.length) throw invalidCompletion();
  const itemsById = new Map((items.data || []).map(item => [item.id, item]));
  const canonicalAccounts = new Map();
  for (const account of retired.data) {
    const identity = plaidAccountIdentity(account, savedItem.institution_id);
    const canonical = identity && (accounts.data || []).find(candidate => {
      const item = itemsById.get(candidate.plaid_item_record_id);
      return item && plaidAccountIdentity(candidate, item.institution_id) === identity;
    });
    if (!canonical) throw invalidCompletion();
    canonicalAccounts.set(canonical.id, canonical);
  }
  const itemIds = [...new Set([...canonicalAccounts.values()].map(account => account.plaid_item_record_id))];
  if (!itemIds.length) throw invalidCompletion();
  return { ...result, item_id: itemIds[0], item_ids: itemIds,
    institution_name: itemsById.get(itemIds[0]).institution_name || result.institution_name,
    accounts_count: canonicalAccounts.size, connection_saved: true };
}

async function verifySavedConnection(result, { client, userId, householdId }) {
  validateConnectionResult(result);
  // The exchange response must describe records that actually belong to this
  // user and household, rather than relying on a provider/sync count alone.
  const saved = await client.from("plaid_items").select("id,status,institution_id,institution_name")
    .eq("id", result.item_id).eq("user_id", userId).eq("household_id", householdId)
    .maybeSingle();
  if (saved.error || !saved.data || saved.data.id !== result.item_id) throw invalidCompletion();
  // Deduplication can retain an older connection and retire the new duplicate.
  // Prove the surviving accounts using the same identity rules as sync.
  if (saved.data.status === "removed") {
    if (result.already_connected !== true) throw invalidCompletion();
    return verifyCanonicalConnection(result, { client, userId, householdId, savedItem: saved.data });
  }
  if (!["active", "needs_repair"].includes(saved.data.status)) throw invalidCompletion();
  const accounts = await client.from("plaid_accounts").select("id", { count: "exact", head: true })
    .eq("plaid_item_record_id", result.item_id).eq("user_id", userId)
    .eq("household_id", householdId).eq("is_active", true);
  if (accounts.error || !Number.isSafeInteger(accounts.count) || accounts.count < 0) throw invalidCompletion();
  return { ...result, accounts_count: accounts.count, connection_saved: true };
}

function aggregateConnections(results) {
  if (!Array.isArray(results) || results.length === 0) throw invalidCompletion();
  for (const result of results) validateConnectionResult(result, true);
  const totals = Object.fromEntries(COUNT_FIELDS.map(field => {
    const total = results.reduce((sum, result) => sum + (result[field] ?? 0), 0);
    if (!Number.isSafeInteger(total)) throw invalidCompletion();
    return [field, total];
  }));
  const accountsPending = results.some(result => result.accounts_count === 0);
  const alreadyConnected = results.every(result => result.already_connected);
  return {
    ok: true,
    item_id: results[0].item_id,
    item_ids: [...new Set(results.flatMap(result => result.item_ids || [result.item_id]))],
    institution_name: results[0].institution_name || "Connected bank",
    status: accountsPending ? "accounts_pending" : alreadyConnected ? "already_connected" : "connected",
    connection_saved: true,
    already_connected: alreadyConnected,
    ...totals,
    ...(accountsPending ? { message: "Your bank connection is saved. Accounts are still being prepared." } : {}),
    liability_details_available: results.some(result => result.liability_details_available),
    transactions_pending: results.some(result => result.transactions_pending),
    history_status: results.some(result => result.history_status === "importing") ? "importing"
      : results.some(result => result.history_status === "complete") ? "complete" : null,
    subscriptions_pending: results.some(result => result.subscriptions_pending),
  };
}

function completionDiagnostic(report, classification, linkData, tokenCount = 0) {
  const requestId = linkData?.request_id;
  const safeRequestId = typeof requestId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)
    && !/^(?:access|public|link)-/.test(requestId) ? requestId : null;
  try {
    report({ classification, session_count: Array.isArray(linkData?.link_sessions) ? linkData.link_sessions.length : 0,
      public_token_count: tokenCount, provider_request_id: safeRequestId });
  } catch { /* Diagnostics cannot change whether a connection completes. */ }
}

function createExchangePublicTokenHandler(dependencies = {}) {
  const authenticate = dependencies.authenticatedUser || authenticatedUser;
  const authorize = dependencies.authorizeProHousehold || authorizeProHousehold;
  const plaidFactory = dependencies.plaid || plaid;
  const connect = dependencies.connectPlaidPublicToken || connectPlaidPublicToken;
  const database = dependencies.serviceSupabase || serviceSupabase;
  const report = dependencies.completionDiagnostic || (entry => console.info("plaid_connection_completion", entry));
  return async function exchangePublicToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticate(req);
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
  let linkData;
  let completedTokenCount = 0;
  try {
    const access = await authorize(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });

    let publicTokens = publicToken ? [publicToken] : [];
    if (hostedSession) {
      const session = validateHostedLinkSession(hostedSession, { userId: auth.user.id, householdId: access.householdId });
      linkData = (await plaidFactory().linkTokenGet({ link_token: session.linkToken })).data;
      const completion = hostedLinkCompletion(linkData);
      completedTokenCount = completion.publicTokens.length;
      completionDiagnostic(report, completion.status, linkData, completedTokenCount);
      if (completion.status === "pending") {
        return res.status(202).json({ ok: false, status: "pending", message: "Plaid is finishing the secure connection." });
      }
      if (completion.status === "exited") {
        return res.status(409).json({ error: "PLAID_LINK_EXITED", message: "Account connection was not completed. Please try again." });
      }
      publicTokens = completion.publicTokens;
    }

    const results = [];
    for (const token of publicTokens) {
      const result = await connect({ publicToken: token, userId: auth.user.id, householdId: access.householdId });
      results.push(await verifySavedConnection(result, { client: database(), userId: auth.user.id, householdId: access.householdId }));
    }
    const result = aggregateConnections(results);
    completionDiagnostic(report, result.status, linkData, publicTokens.length);
    return res.status(200).json(result);
  } catch (error) {
    completionDiagnostic(report, "failed", linkData, completedTokenCount);
    if (error instanceof PlaidItemConflictError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    const code = error && error.response && error.response.data && error.response.data.error_code || error.code || "PUBLIC_TOKEN_EXCHANGE_FAILED";
    if (code === "PLAID_ACCOUNT_ALREADY_CONNECTED_TO_ANOTHER_HOUSEHOLD") {
      return res.status(409).json({
        error: code,
        message: "This bank account is already connected to another household. Switch to that household to manage it.",
      });
    }
    const status = code === "PLAID_LINK_SESSION_INVALID" ? 400 : 500;
    return res.status(status).json({ error: code, message: publicError(error, "Could not finish connecting this bank.") });
  }
  };
}

module.exports = createExchangePublicTokenHandler();
module.exports.createExchangePublicTokenHandler = createExchangePublicTokenHandler;
module.exports.aggregateConnections = aggregateConnections;

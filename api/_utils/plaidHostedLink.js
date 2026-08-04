const { openPlaidLinkSession } = require("./crypto");

const MAX_HOSTED_PUBLIC_TOKENS = 5;

function invalidSession(message = "This Plaid connection session expired. Please start again.") {
  const error = new Error(message);
  error.code = "PLAID_LINK_SESSION_INVALID";
  return error;
}

function validateHostedLinkSession(value, { userId, householdId, now = Date.now() }) {
  if (!value || String(value).length > 4096) throw invalidSession();
  const payload = openPlaidLinkSession(String(value));
  const expiresAt = Date.parse(String(payload.expiresAt || ""));
  if (payload.version !== 1
    || payload.intent !== "credit_card"
    || typeof payload.linkToken !== "string"
    || !payload.linkToken.startsWith("link-")
    || payload.linkToken.length > 512
    || payload.userId !== userId
    || payload.householdId !== householdId
    || !Number.isFinite(expiresAt)
    || expiresAt <= now) {
    throw invalidSession();
  }
  return { linkToken: payload.linkToken, intent: payload.intent, expiresAt };
}

function publicTokensFromSession(session) {
  const results = Array.isArray(session?.results?.item_add_results)
    ? session.results.item_add_results
    : [];
  const tokens = results.map(result => result && result.public_token).filter(Boolean);
  if (tokens.length === 0 && session?.on_success?.public_token) tokens.push(session.on_success.public_token);
  return tokens.filter(token => typeof token === "string" && token.length <= 512);
}

function hostedLinkCompletion(data) {
  const sessions = Array.isArray(data?.link_sessions) ? data.link_sessions : [];
  const publicTokens = [...new Set(sessions.flatMap(publicTokensFromSession))].slice(0, MAX_HOSTED_PUBLIC_TOKENS);
  if (publicTokens.length > 0) return { status: "success", publicTokens };
  if (sessions.some(session => !session?.finished_at)) return { status: "pending", publicTokens: [] };
  if (sessions.length === 0) return { status: "pending", publicTokens: [] };
  return { status: "exited", publicTokens: [] };
}

module.exports = { hostedLinkCompletion, validateHostedLinkSession };

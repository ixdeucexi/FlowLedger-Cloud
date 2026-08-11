const { authenticatedUser, safeError, serviceSupabase } = require("../_utils/supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("../_utils/plaidAccess");
const { isPlaidAccountRecordId, updatePlaidSavingsAccountDisplayName } = require("../_utils/plaidAccountNickname");

module.exports = async function plaidAccountNickname(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });

  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
    if (!isPlaidAccountRecordId(accountId)) return res.status(400).json({ error: "ACCOUNT_REQUIRED", message: "Choose a savings account." });

    const result = await updatePlaidSavingsAccountDisplayName({
      db: serviceSupabase(),
      householdId: access.householdId,
      accountId,
      displayName: req.body?.displayName ?? null,
    });
    if (!result.ok) return res.status(result.status).json({ error: "ACCOUNT_NAME_INVALID", message: result.message });
    return res.status(200).json({ account: result.account });
  } catch (error) {
    return res.status(500).json({ error: "ACCOUNT_NAME_UPDATE_FAILED", message: safeError(error, "Could not update the account name.") });
  }
};

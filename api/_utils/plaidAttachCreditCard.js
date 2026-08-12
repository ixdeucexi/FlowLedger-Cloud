const { authenticatedUser, serviceSupabase, publicError } = require("./supabase");
const { authorizeProHousehold, requestedHouseholdId } = require("./plaidAccess");
const { defaultBudgetId, findConnectedCardDebt, recalculateSnowballMinimums, syncItem } = require("./sync");

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

module.exports = async function attachCreditCard(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const auth = await authenticatedUser(req);
  if (!auth.user) return res.status(401).json({ error: auth.error, message: "Please sign in again." });
  const accountRecordId = String(body(req).plaid_account_record_id || "").trim();
  const debtId = String(body(req).debt_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(accountRecordId)) {
    return res.status(400).json({ error: "PLAID_ACCOUNT_INVALID", message: "Choose a connected credit card to attach." });
  }
  if (debtId.length > 160) return res.status(400).json({ error: "DEBT_INVALID", message: "Choose a valid debt account." });

  try {
    const access = await authorizeProHousehold(auth.user.id, requestedHouseholdId(req));
    if (!access.ok) return res.status(access.status).json({ error: access.error, message: access.message });
    const db = serviceSupabase();
    const accountResult = await db
      .from("plaid_accounts")
      .select("id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,account_type,type,is_active")
      .eq("id", accountRecordId)
      .eq("user_id", auth.user.id)
      .eq("household_id", access.householdId)
      .eq("is_active", true)
      .maybeSingle();
    if (accountResult.error) throw accountResult.error;
    const account = accountResult.data;
    if (!account) return res.status(404).json({ error: "PLAID_ACCOUNT_NOT_FOUND", message: "That connected card is no longer available." });
    if (String(account.account_type || account.type || "").toLowerCase() !== "credit") {
      return res.status(400).json({ error: "PLAID_ACCOUNT_NOT_CREDIT", message: "Only connected credit cards can be added to Debt and Snowball." });
    }

    const itemResult = await db
      .from("plaid_items")
      .select("id,user_id,household_id,encrypted_access_token,access_token_ciphertext,transactions_cursor,cursor,status")
      .eq("id", account.plaid_item_record_id)
      .eq("user_id", auth.user.id)
      .eq("household_id", access.householdId)
      .neq("status", "removed")
      .maybeSingle();
    if (itemResult.error) throw itemResult.error;
    if (!itemResult.data) return res.status(409).json({ error: "PLAID_ITEM_RECONNECT_REQUIRED", message: "Reconnect this card before attaching it to your plan." });

    await syncItem({ userId: auth.user.id, item: itemResult.data });
    const refreshedAccountResult = await db
      .from("plaid_accounts")
      .select("id,plaid_account_id,persistent_account_id,name,official_name,mask,current_balance,minimum_payment_amount,next_payment_due_date,purchase_apr")
      .eq("id", account.id)
      .eq("user_id", auth.user.id)
      .eq("household_id", access.householdId)
      .eq("is_active", true)
      .maybeSingle();
    if (refreshedAccountResult.error) throw refreshedAccountResult.error;
    if (!refreshedAccountResult.data) throw new Error("PLAID_ACCOUNT_NOT_FOUND_AFTER_SYNC");
    const refreshedAccount = refreshedAccountResult.data;
    const alreadyLinked = await findConnectedCardDebt({
      db,
      userId: auth.user.id,
      householdId: access.householdId,
      accountRow: refreshedAccount,
    });

    let targetDebt = alreadyLinked;
    if (alreadyLinked && debtId && alreadyLinked.id !== debtId) {
      return res.status(409).json({
        error: "CARD_ALREADY_ATTACHED",
        message: "This connected card is already attached to a different debt account.",
      });
    }
    if (debtId && !targetDebt) {
      const targetResult = await db
        .from("bills")
        .select("id,name,amount,balance,interest_rate,due_day,next_payment_date,plaid_account_record_id,plaid_account_id,plaid_persistent_account_id")
        .eq("id", debtId)
        .eq("user_id", auth.user.id)
        .eq("household_id", access.householdId)
        .eq("is_debt", true)
        .maybeSingle();
      if (targetResult.error) throw targetResult.error;
      if (!targetResult.data) return res.status(404).json({ error: "DEBT_NOT_FOUND", message: "That debt account is no longer available." });
      if (targetResult.data.plaid_account_record_id || targetResult.data.plaid_account_id || targetResult.data.plaid_persistent_account_id) {
        return res.status(409).json({ error: "DEBT_ALREADY_ATTACHED", message: "That debt is already attached to another connected card." });
      }
      targetDebt = targetResult.data;
    }

    const balance = Math.max(0, Number(refreshedAccount.current_balance || 0));
    const reportedMinimum = Number(refreshedAccount.minimum_payment_amount);
    const minimum = Number.isFinite(reportedMinimum) && reportedMinimum > 0.005
      ? reportedMinimum
      : Math.max(0, Number(targetDebt?.amount || 0));
    const reportedApr = Number(refreshedAccount.purchase_apr);
    const apr = Number.isFinite(reportedApr) && reportedApr >= 0
      ? reportedApr
      : Math.max(0, Number(targetDebt?.interest_rate || 0));
    const nextPaymentDate = refreshedAccount.next_payment_due_date || targetDebt?.next_payment_date || null;
    const dueDay = nextPaymentDate
      ? Number(String(nextPaymentDate).slice(8, 10))
      : Math.max(1, Number(targetDebt?.due_day || 1));
    const name = targetDebt?.name
      || `${refreshedAccount.official_name || refreshedAccount.name || "Credit card"}${refreshedAccount.mask ? ` •••• ${refreshedAccount.mask}` : ""}`;
    const now = new Date().toISOString();
    const liveDebtFields = {
      is_debt: true,
      category: "Debt",
      balance,
      amount: minimum,
      interest_rate: apr,
      due_day: dueDay,
      next_payment_date: nextPaymentDate,
      is_recurring: true,
      frequency: "monthly",
      include_in_snowball: true,
      plaid_account_record_id: refreshedAccount.id,
      plaid_account_id: refreshedAccount.plaid_account_id,
      plaid_persistent_account_id: refreshedAccount.persistent_account_id || null,
      plaid_last_synced_at: now,
    };

    if (targetDebt) {
      const update = await db
        .from("bills")
        .update(liveDebtFields)
        .eq("id", targetDebt.id)
        .eq("user_id", auth.user.id)
        .eq("household_id", access.householdId);
      if (update.error) throw update.error;
    } else {
      const budgetId = await defaultBudgetId(db, access.householdId);
      const inserted = await db.from("bills").upsert({
        id: `plaid-debt:${refreshedAccount.id}`,
        user_id: auth.user.id,
        household_id: access.householdId,
        budget_id: budgetId,
        name,
        priority: 0,
        created_at: now,
        ...liveDebtFields,
      }, { onConflict: "id" }).select("id,name").single();
      if (inserted.error) throw inserted.error;
      targetDebt = inserted.data;
    }
    await recalculateSnowballMinimums({ db, userId: auth.user.id, householdId: access.householdId });

    return res.status(200).json({ ok: true, debt_id: targetDebt.id, debt_name: targetDebt.name || name, include_in_snowball: true });
  } catch (error) {
    return res.status(500).json({ error: error.code || "CARD_ATTACH_FAILED", message: publicError(error, "Could not add this card to Debt and Snowball.") });
  }
};

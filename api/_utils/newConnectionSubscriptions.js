const { detectSubscriptions, normalizeMerchant } = require("../../artifacts/mobile/lib/subscriptionDetector");

const PAGE_SIZE = 500;
const NEW_IMPORT_VERSION = 1;

function stableSubscriptionId(seed) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const chunks = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
  return `${chunks.slice(0, 8)}-${chunks.slice(8, 12)}-4${chunks.slice(13, 16)}-a${chunks.slice(17, 20)}-${chunks.slice(20, 32)}`;
}

async function allRows(build) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await build().range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function isExcludedCategory(value) {
  return ["debt", "transfer", "income", "debt_payment"].includes(String(value || "").toLowerCase().trim());
}

/** Make review evidence only. This never creates or changes cash transactions. */
function subscriptionEvidence(ledger, canonical) {
  if (!ledger || ledger.pending || ledger.removed_at || !Number.isFinite(Number(ledger.amount)) || Number(ledger.amount) >= 0) return null;
  if (canonical && (canonical.pending || canonical.removed_at || canonical.deleted_at
    || isExcludedCategory(canonical.category)
    || ["transfer", "debt_payment"].includes(canonical.review_status)
    || canonical.debt_applied_bill_id || canonical.transfer_group_id)) return null;
  const primary = String(ledger.raw?.personal_finance_category?.primary || "").toUpperCase();
  if (isExcludedCategory(ledger.category) || primary.startsWith("TRANSFER") || primary === "LOAN_PAYMENTS") return null;
  const merchant = String(ledger.merchant_name || ledger.name || ledger.original_name || "").trim();
  if (!merchant || !normalizeMerchant(merchant) || !/^\d{4}-\d{2}-\d{2}$/.test(String(ledger.transaction_date || ""))) return null;
  return {
    id: canonical?.id || `plaid-ledger:${ledger.plaid_transaction_id}`,
    date: ledger.transaction_date,
    amount: Number(ledger.amount),
    description: merchant,
    category: ledger.category,
    canonicalId: canonical?.id || null,
    plaidId: ledger.plaid_transaction_id,
  };
}

function candidatePayloads(evidence, householdId) {
  const byId = new Map(evidence.map(row => [row.id, row]));
  return detectSubscriptions(evidence).map(candidate => {
    const source = candidate.transactionIds.slice(-500).map(id => byId.get(id)).filter(Boolean);
    return {
      id: stableSubscriptionId(`subscription:${householdId}:${normalizeMerchant(candidate.merchant)}`),
      merchant: candidate.merchant,
      cadence: candidate.cadence,
      average_amount: candidate.averageAmount,
      monthly_equivalent: candidate.monthlyEquivalent,
      yearly_equivalent: candidate.yearlyEquivalent,
      confidence: candidate.confidence,
      source_transaction_ids: [...new Set(source.map(row => row.canonicalId).filter(Boolean))],
      source_plaid_transaction_ids: [...new Set(source.map(row => row.plaidId).filter(Boolean))],
    };
  });
}

async function refreshNewConnectionSubscriptions({ db, userId, item }) {
  if (item?.initial_import_version !== NEW_IMPORT_VERSION || !item.household_id || item.status === "removed") return { candidates: 0, skipped: true };
  const { data: admin, error: adminError } = await db.from("feedback_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (adminError) throw adminError;
  if (admin) return { candidates: 0, skipped: true };
  const householdId = item.household_id;
  const items = await allRows(() => db.from("plaid_items")
    .select("id,user_id").eq("household_id", householdId).eq("initial_import_version", NEW_IMPORT_VERSION)
    .in("status", ["active", "needs_repair"]).order("id"));
  const authors = [...new Set(items.map(row => row.user_id))];
  if (!authors.length) return { candidates: 0, skipped: true };
  const admins = await allRows(() => db.from("feedback_admins").select("user_id").in("user_id", authors).order("user_id"));
  const adminIds = new Set(admins.map(row => row.user_id));
  const itemIds = items.filter(row => !adminIds.has(row.user_id)).map(row => row.id);
  if (!itemIds.includes(item.id)) return { candidates: 0, skipped: true };
  const accounts = await allRows(() => db.from("plaid_accounts").select("id")
    .eq("household_id", householdId).in("plaid_item_record_id", itemIds).eq("is_active", true).order("id"));
  if (!accounts.length) return { candidates: 0 };
  const accountIds = accounts.map(row => row.id);
  const ledger = await allRows(() => db.from("plaid_transactions")
    .select("id,plaid_transaction_id,flowledger_transaction_id,transaction_date,amount,name,merchant_name,original_name,category,pending,removed_at,raw")
    .eq("household_id", householdId).in("plaid_account_id", accountIds).eq("pending", false).is("removed_at", null).order("id"));
  const canonicalIds = [...new Set(ledger.map(row => row.flowledger_transaction_id).filter(Boolean))];
  const canonical = [];
  for (let start = 0; start < canonicalIds.length; start += 200) {
    canonical.push(...await allRows(() => db.from("transactions")
      .select("id,pending,removed_at,deleted_at,category,review_status,debt_applied_bill_id,transfer_group_id")
      .eq("household_id", householdId).in("id", canonicalIds.slice(start, start + 200)).order("id")));
  }
  const byCanonical = new Map(canonical.map(row => [row.id, row]));
  const evidence = [...new Map(ledger.flatMap(row => {
    // A formerly canonical row that is absent must not reappear as raw evidence.
    if (row.flowledger_transaction_id && !byCanonical.has(row.flowledger_transaction_id)) return [];
    const result = subscriptionEvidence(row, byCanonical.get(row.flowledger_transaction_id));
    return result ? [[result.id, result]] : [];
  })).values()];
  const candidates = candidatePayloads(evidence, householdId);
  let saved = 0;
  for (let start = 0; start < candidates.length; start += 100) {
    const { data, error } = await db.rpc("merge_new_connection_subscription_candidates", {
      p_user_id: userId, p_household_id: householdId, p_item_id: item.id,
      p_candidates: candidates.slice(start, start + 100),
    });
    if (error) throw error;
    saved += Number(data?.saved || 0);
  }
  return { candidates: saved };
}

module.exports = { candidatePayloads, refreshNewConnectionSubscriptions, stableSubscriptionId, subscriptionEvidence };

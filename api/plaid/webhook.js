const { readJsonBody, sendJson } = require("../_utils/plaid");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  console.log("Plaid webhook received", {
    webhook_type: body.webhook_type,
    webhook_code: body.webhook_code,
    item_id: body.item_id,
  });

  return sendJson(res, 200, { ok: true });
};

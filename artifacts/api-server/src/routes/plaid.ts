import { Router } from "express";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

const router = Router();

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env["PLAID_CLIENT_ID"] ?? "",
      "PLAID-SECRET": process.env["PLAID_SECRET"] ?? "",
    },
  },
});

const plaid = new PlaidApi(plaidConfig);

// Temporary in-memory store: session_id → { public_token, institution }
// Entries expire after 5 minutes
const pendingSessions = new Map<string, { public_token: string; institution: string; ts: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingSessions) {
    if (now - entry.ts > 5 * 60 * 1000) pendingSessions.delete(id);
  }
}, 60_000);

// GET /api/plaid/link?session=SESSION_ID
// Serves the Plaid Link HTML page. On success redirects to /api/plaid/callback
// (no custom app scheme — works in Expo Go)
router.get("/plaid/link", async (req, res) => {
  const session = (req.query["session"] as string) || "default";
  try {
    const tokenRes = await plaid.linkTokenCreate({
      user: { client_user_id: "flowledger-user" },
      client_name: "FlowLedger",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    const linkToken = tokenRes.data.link_token;

    // Use the public Replit domain so the callback URL works on physical devices
    const publicHost =
      (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim() ||
      process.env["REPLIT_DEV_DOMAIN"] ||
      req.get("host");
    const callbackBase = `https://${publicHost}/api/plaid/callback`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Bank — FlowLedger</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, sans-serif;
      background: #0a0e1a;
      color: #e2e8f0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .logo { font-size: 26px; font-weight: 800; color: #22c55e; letter-spacing: -0.5px; }
    .sub  { font-size: 14px; color: #6b7a99; max-width: 280px; line-height: 1.5; }
    #open-btn {
      margin-top: 16px;
      background: linear-gradient(135deg, #1d4ed8, #16a34a);
      color: #fff;
      border: none;
      border-radius: 14px;
      padding: 16px 32px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      max-width: 320px;
    }
    #open-btn:disabled { opacity: 0.5; }
    #status { font-size: 13px; color: #6b7a99; margin-top: 8px; min-height: 20px; }
    .badge { font-size: 11px; color: #6b7a99; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="logo">FlowLedger</div>
  <div class="sub">Securely connect your bank account via Plaid</div>
  <button id="open-btn">Connect Bank Account</button>
  <div id="status"></div>
  <div class="badge">🔒 Sandbox mode · no real data accessed</div>

  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    var SESSION = '${session}';
    var CALLBACK = '${callbackBase}';

    var handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: function(public_token, metadata) {
        document.getElementById('status').textContent = 'Connected! Saving…';
        document.getElementById('open-btn').disabled = true;
        var institution = encodeURIComponent((metadata.institution || {}).name || 'Your Bank');
        var token = encodeURIComponent(public_token);
        window.location.href = CALLBACK + '?session=' + SESSION + '&public_token=' + token + '&institution=' + institution;
      },
      onExit: function() {
        document.getElementById('status').textContent = 'Cancelled — you can return to the app.';
      },
      onLoad: function() {
        document.getElementById('open-btn').disabled = false;
      },
    });

    document.getElementById('open-btn').addEventListener('click', function() {
      document.getElementById('status').textContent = 'Opening Plaid…';
      handler.open();
    });
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Plaid link page error");
    res.status(500).send("<h2 style='color:red;font-family:sans-serif;padding:24px'>Failed to load Plaid Link. Check server logs.</h2>");
  }
});

// GET /api/plaid/callback?session=...&public_token=...&institution=...
// Called by the Plaid Link HTML page after success. Stores token and shows a close page.
router.get("/plaid/callback", (req, res) => {
  const session      = req.query["session"] as string;
  const publicToken  = req.query["public_token"] as string;
  const institution  = req.query["institution"] as string | undefined;

  if (!session || !publicToken) {
    res.status(400).send("Missing session or public_token");
    return;
  }

  pendingSessions.set(session, {
    public_token: publicToken,
    institution: institution ?? "Your Bank",
    ts: Date.now(),
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connected — FlowLedger</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0a0e1a; color: #e2e8f0; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; gap:16px; padding:24px; text-align:center; }
    .check { font-size: 64px; }
    .title { font-size: 22px; font-weight: 700; color: #22c55e; }
    .sub   { font-size: 14px; color: #6b7a99; max-width: 260px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="check">✅</div>
  <div class="title">Bank Connected!</div>
  <div class="sub">You can now close this window and return to FlowLedger.</div>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// GET /api/plaid/poll?session=...
// Mobile app polls this to get the public_token after the browser flow completes
router.get("/plaid/poll", (req, res) => {
  const session = req.query["session"] as string;
  if (!session) { res.status(400).json({ error: "session required" }); return; }

  const entry = pendingSessions.get(session);
  if (!entry) {
    res.json({ ready: false });
    return;
  }

  pendingSessions.delete(session);
  res.json({ ready: true, public_token: entry.public_token, institution: entry.institution });
});

// POST /api/plaid/exchange-token
router.post("/plaid/exchange-token", async (req, res) => {
  const { public_token } = req.body as { public_token?: string };
  if (!public_token) { res.status(400).json({ error: "public_token required" }); return; }
  try {
    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token });
    const accessToken  = exchangeRes.data.access_token;
    const accountsRes  = await plaid.accountsGet({ access_token: accessToken });
    const accounts = accountsRes.data.accounts.map(a => ({
      id: a.account_id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balance_current: a.balances.current,
      balance_available: a.balances.available,
    }));
    res.json({ access_token: accessToken, accounts });
  } catch (err: any) {
    req.log.error({ err }, "Plaid token exchange error");
    res.status(500).json({ error: "Token exchange failed" });
  }
});

// POST /api/plaid/transactions
router.post("/plaid/transactions", async (req, res) => {
  const { access_token } = req.body as { access_token?: string };
  if (!access_token) { res.status(400).json({ error: "access_token required" }); return; }
  try {
    const now   = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    const fmt   = (d: Date) => d.toISOString().split("T")[0]!;
    const txRes = await plaid.transactionsGet({
      access_token,
      start_date: fmt(start),
      end_date: fmt(now),
      options: { count: 100, offset: 0 },
    });
    const txs = txRes.data.transactions.map(t => ({
      id:       t.transaction_id,
      date:     t.date,
      name:     t.name,
      amount:   t.amount,
      category: t.personal_finance_category?.primary ?? (t.category?.[0] ?? "Other"),
      pending:  t.pending,
    }));
    res.json({ transactions: txs, accounts: txRes.data.accounts });
  } catch (err: any) {
    req.log.error({ err }, "Plaid transactions error");
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;

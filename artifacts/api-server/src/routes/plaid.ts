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

// POST /api/plaid/link-token
// Creates a Plaid Link token for the frontend to initialise Plaid Link
router.post("/plaid/link-token", async (req, res) => {
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: "flowledger-user" },
      client_name: "FlowLedger",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: undefined,
    });
    res.json({ link_token: response.data.link_token });
  } catch (err: any) {
    req.log.error({ err }, "Plaid link-token error");
    res.status(500).json({ error: "Failed to create link token" });
  }
});

// GET /api/plaid/link  — serves the HTML page that runs Plaid Link in a browser
// The app opens this URL in a WebBrowser, Plaid Link runs, then redirects to
// mobile://plaid-success?public_token=xxx or mobile://plaid-exit
router.get("/plaid/link", async (req, res) => {
  try {
    const tokenRes = await plaid.linkTokenCreate({
      user: { client_user_id: "flowledger-user" },
      client_name: "FlowLedger",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    const linkToken = tokenRes.data.link_token;

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
    }
    .logo { font-size: 24px; font-weight: 700; color: #22c55e; }
    .sub  { font-size: 14px; color: #6b7a99; }
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
    #status { font-size: 13px; color: #6b7a99; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="logo">FlowLedger</div>
  <div class="sub">Securely connect your bank account</div>
  <button id="open-btn">Connect Bank Account</button>
  <div id="status"></div>

  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    var handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: function(public_token, metadata) {
        document.getElementById('status').textContent = 'Connected! Returning to app…';
        document.getElementById('open-btn').disabled = true;
        window.location.href = 'mobile://plaid-success?public_token=' + encodeURIComponent(public_token) + '&institution=' + encodeURIComponent((metadata.institution || {}).name || '');
      },
      onExit: function(err) {
        document.getElementById('status').textContent = 'Cancelled.';
        window.location.href = 'mobile://plaid-exit';
      },
      onLoad: function() {
        document.getElementById('open-btn').disabled = false;
      },
    });
    document.getElementById('open-btn').addEventListener('click', function() {
      handler.open();
    });
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Plaid link page error");
    res.status(500).send("<h2>Failed to load Plaid Link. Check server logs.</h2>");
  }
});

// POST /api/plaid/exchange-token
// Exchanges the public_token for an access_token and fetches accounts
router.post("/plaid/exchange-token", async (req, res) => {
  const { public_token } = req.body as { public_token?: string };
  if (!public_token) {
    res.status(400).json({ error: "public_token required" });
    return;
  }
  try {
    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token });
    const accessToken  = exchangeRes.data.access_token;

    const accountsRes = await plaid.accountsGet({ access_token: accessToken });
    const accounts = accountsRes.data.accounts.map(a => ({
      id: a.account_id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balance_current: a.balances.current,
      balance_available: a.balances.available,
    }));

    // NOTE: In production you would store accessToken server-side per user.
    // For sandbox/demo we return it so the client can make further calls.
    res.json({ access_token: accessToken, accounts });
  } catch (err: any) {
    req.log.error({ err }, "Plaid token exchange error");
    res.status(500).json({ error: "Token exchange failed" });
  }
});

// POST /api/plaid/transactions
// Fetches recent transactions for a connected account
router.post("/plaid/transactions", async (req, res) => {
  const { access_token } = req.body as { access_token?: string };
  if (!access_token) {
    res.status(400).json({ error: "access_token required" });
    return;
  }
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

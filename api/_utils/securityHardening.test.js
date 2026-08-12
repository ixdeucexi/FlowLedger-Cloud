const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { publicError } = require("./supabase");

test("public API errors never expose provider or database details", () => {
  const internal = new Error("permission denied for table plaid_items constraint plaid_items_user_id_fkey secret-token");
  assert.equal(publicError(internal, "Could not load bank connections."), "Could not load bank connections.");
  assert.doesNotMatch(publicError(internal), /plaid_items|constraint|secret-token/i);
});

test("500 responses use fixed public messages instead of diagnostic errors", () => {
  const apiRoot = path.resolve(__dirname, "..");
  const files = [
    "admin/money-health.js",
    "admin/tester-plan.js",
    "feedback.js",
    "money-health/nightly.js",
    "plaid/create-link-token.js",
    "plaid/disconnect.js",
    "plaid/exchange-public-token.js",
    "plaid/status.js",
    "plaid/sync.js",
    "plaid/webhook.js",
    "_utils/plaidAttachCreditCard.js",
    "_utils/notificationRoutes/preferences.js",
    "_utils/notificationRoutes/subscription.js",
    "_utils/notificationRoutes/test.js",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(apiRoot, file), "utf8");
    const serverErrorResponses = [...source.matchAll(/status\(500\)[\s\r\n.]*json\(([\s\S]*?)\);/g)];
    for (const response of serverErrorResponses) {
      assert.doesNotMatch(response[1], /message:\s*(?:safeError\(|error\.message)/, file);
    }
  }
});

test("Vercel applies the required browser security policy to every route", () => {
  const workspaceRoot = path.resolve(__dirname, "../..");
  const config = JSON.parse(readFileSync(path.resolve(workspaceRoot, "vercel.json"), "utf8"));
  const global = config.headers.find(entry => entry.source === "/(.*)");
  assert.ok(global);
  const headers = new Map(global.headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(headers.get("content-security-policy"), /connect-src[^;]*supabase\.co/);
  assert.match(headers.get("content-security-policy"), /script-src[^;]*cdn\.plaid\.com/);
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(headers.get("permissions-policy"), /camera=\(\)/);
});

test("production build is gated by API and mobile tests", () => {
  const workspaceRoot = path.resolve(__dirname, "../..");
  const pkg = JSON.parse(readFileSync(path.resolve(workspaceRoot, "package.json"), "utf8"));
  assert.match(pkg.scripts.test, /test:api/);
  assert.match(pkg.scripts.test, /test:mobile/);
  assert.match(pkg.scripts.build, /pnpm run test/);
  assert.match(pkg.scripts["typecheck:libs"], /tsc --build --force/);
  assert.match(pkg.scripts.verify, /pnpm audit --prod --audit-level high/);
});

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appleSecrets = [
  "APPLE_TOKEN_ENCRYPTION_KEY",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_CLIENT_ID",
  "APPLE_PRIVATE_KEY",
];

const parsed = JSON.parse(execSync("vercel env ls --format json", {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
}));
const byName = new Map();
for (const entry of parsed.envs || []) {
  const entries = byName.get(entry.key) || [];
  entries.push(entry);
  byName.set(entry.key, entries);
}

for (const name of appleSecrets) {
  const entries = byName.get(name) || [];
  if (entries.length !== 1) {
    throw new Error(`Native iOS release requires exactly one ${name} Vercel record.`);
  }
  const entry = entries[0];
  if (
    entry.gitBranch
    || !Array.isArray(entry.target)
    || entry.target.length !== 1
    || entry.target[0] !== "production"
  ) {
    throw new Error(`${name} must target Production only before Apple sign-in is enabled.`);
  }
}

const associationPath = path.join(
  root,
  "artifacts",
  "mobile",
  "public",
  ".well-known",
  "apple-app-site-association",
);
if (!fs.existsSync(associationPath)) {
  throw new Error(
    "Native iOS release requires a verified apple-app-site-association file for com.flowledger.app.",
  );
}
const association = JSON.parse(fs.readFileSync(associationPath, "utf8"));
const appIds = (association.applinks?.details || [])
  .flatMap(detail => detail.appIDs || (detail.appID ? [detail.appID] : []));
if (!appIds.some(appId => /^[A-Z0-9]{10}\.com\.flowledger\.app$/.test(appId))) {
  throw new Error(
    "apple-app-site-association must include the verified Apple Team ID for com.flowledger.app.",
  );
}

console.log("Native iOS provider secrets and Universal Link association are release-ready.");

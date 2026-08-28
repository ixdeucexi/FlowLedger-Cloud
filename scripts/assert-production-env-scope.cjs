const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const canonicalProject = {
  id: "prj_nOlgvktXdfLErqQvmESnvyLFnMj2",
  orgId: "team_jIrgjLphz4oeVh6WuFHaiWKq",
  name: "flow-ledger-cloud",
  domain: "flowledger-algo.com",
};
const productionHosts = [
  canonicalProject.domain,
  `www.${canonicalProject.domain}`,
  `${canonicalProject.name}.vercel.app`,
  "flow-ledger-cloud-flow-ledger-s-projects.vercel.app",
];

function runVercel(args) {
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "vercel", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  }
  return execFileSync("vercel", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const output = runVercel(["env", "ls", "--format", "json"]);
const parsed = JSON.parse(output);
const envByName = new Map();
for (const entry of parsed.envs || []) {
  const entries = envByName.get(entry.key) || [];
  entries.push(entry);
  envByName.set(entry.key, entries);
}

const requiredProductionOnly = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_REDIRECT_URI",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "PLAID_WEBHOOK_URL",
  "CRON_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];
const optionalProductionOnly = [
  "APPLE_TOKEN_ENCRYPTION_KEY",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_CLIENT_ID",
  "APPLE_PRIVATE_KEY",
  "REVENUECAT_SECRET_API_KEY",
];

function assertProductionOnly(name, required) {
  const entries = envByName.get(name) || [];
  if (!entries.length) {
    if (required) throw new Error(`Missing required Vercel environment variable: ${name}`);
    return;
  }
  if (entries.length !== 1) {
    throw new Error(`${name} has ${entries.length} Vercel records; expected exactly one Production-only record.`);
  }
  const entry = entries[0];
  const targets = [...(entry.target || [])].sort();
  if (targets.length !== 1 || targets[0] !== "production" || entry.gitBranch) {
    throw new Error(
      `${name} must target Production only with no branch override; found ${targets.join(", ") || "no targets"}${entry.gitBranch ? ` on ${entry.gitBranch}` : ""}.`,
    );
  }
}

for (const name of requiredProductionOnly) assertProductionOnly(name, true);
const configuredAppleSecrets = optionalProductionOnly
  .filter(name => name.startsWith("APPLE_"))
  .filter(name => (envByName.get(name) || []).length > 0);
if (configuredAppleSecrets.length > 0 && configuredAppleSecrets.length < 5) {
  throw new Error("Apple provider secrets must be configured as one complete Production-only set.");
}
for (const name of optionalProductionOnly) assertProductionOnly(name, false);

const projectLinkPath = path.join(root, ".vercel", "project.json");
if (!fs.existsSync(projectLinkPath)) {
  throw new Error("Missing .vercel/project.json. Link the canonical Vercel project before release checks.");
}
const projectLink = JSON.parse(fs.readFileSync(projectLinkPath, "utf8"));
if (
  projectLink.projectId !== canonicalProject.id
  || projectLink.orgId !== canonicalProject.orgId
  || projectLink.projectName !== canonicalProject.name
) {
  throw new Error("The local Vercel link does not identify the canonical FlowLedger project and organization.");
}
const project = JSON.parse(runVercel(["api", `/v9/projects/${projectLink.projectId}`, "--raw"]));
if (
  project.id !== canonicalProject.id
  || project.accountId !== canonicalProject.orgId
  || project.name !== canonicalProject.name
) {
  throw new Error("The live Vercel project identity does not match the canonical FlowLedger release target.");
}
const expectedProjectSettings = {
  nodeVersion: "24.x",
  buildCommand: "pnpm --filter @workspace/mobile exec expo export --platform web",
  outputDirectory: "artifacts/mobile/dist",
  installCommand: "pnpm install",
  rootDirectory: null,
};
for (const [key, expected] of Object.entries(expectedProjectSettings)) {
  const actual = project[key] ?? null;
  if (actual !== expected) {
    throw new Error(
      `Vercel project setting ${key} drifted: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
    );
  }
}

const productionDeployments = productionHosts.map(host => ({
  host,
  value: JSON.parse(runVercel(["inspect", host, "--format=json"])),
}));
const canonicalDeployment = productionDeployments[0].value;
if (typeof canonicalDeployment.id !== "string" || canonicalDeployment.id.trim().length === 0) {
  throw new Error(`${productionHosts[0]} returned no production deployment ID.`);
}
for (const { host, value } of productionDeployments) {
  if (
    typeof value.id !== "string"
    || value.id.trim().length === 0
    || value.name !== canonicalProject.name
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.id !== canonicalDeployment.id
  ) {
    throw new Error(
      `${host} does not resolve to the same ready production deployment of the linked FlowLedger project.`,
    );
  }
}

console.log("Vercel credentials are Production-only and canonical project build settings match the release contract.");

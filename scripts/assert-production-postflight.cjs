const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertExecutableJavaScriptResponse,
  assertStartupShell,
} = require("./startup-shell-contract.cjs");

const root = path.resolve(__dirname, "..");
const canonicalOrigin = "https://flowledger-algo.com";
const projectName = "flow-ledger-cloud";
const productionHosts = [
  "flowledger-algo.com",
  "www.flowledger-algo.com",
  "flow-ledger-cloud.vercel.app",
  "flow-ledger-cloud-flow-ledger-s-projects.vercel.app",
];
const knownWithdrawnAsset = "/_expo/static/js/web/entry-e9198b74c50a865838a5b289c61e00e3.js";
const forbidden = [
  /FlowLedger-Algo LLC/i,
  /P\.O\. Box 1234/i,
  /Madison County, Alabama/i,
  /LegalAcceptanceGate/i,
  /LegalDocument(?:Content|Modal)?/i,
  /Terms of Service/i,
  /Privacy Policy/i,
  /Monthly Outlook/i,
  /Actual close/i,
  /Projected close/i,
];

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function vercel(...args) {
  if (process.platform === "win32") {
    return execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "vercel", ...args],
      { cwd: root, encoding: "utf8" },
    ).trim();
  }
  return execFileSync("vercel", args, { cwd: root, encoding: "utf8" }).trim();
}

function assertCleanCopy(content, label) {
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`${label} still contains withdrawn copy ${pattern}.`);
  }
}

async function fetchWithRetry(url, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw lastError;
}

async function main() {
  const commit = git("rev-parse", "HEAD");
  const inspections = productionHosts.map(host => ({
    host,
    value: JSON.parse(vercel("inspect", host, "--format=json")),
  }));
  const inspection = inspections[0].value;
  if (typeof inspection.id !== "string" || inspection.id.trim().length === 0) {
    throw new Error(`${productionHosts[0]} returned no production deployment ID.`);
  }
  for (const { host, value } of inspections) {
    if (
      typeof value.id !== "string"
      || value.id.trim().length === 0
      || value.name !== projectName
      || value.target !== "production"
      || value.readyState !== "READY"
      || value.id !== inspection.id
    ) {
      throw new Error(
        `${host} does not resolve to the same ready FlowLedger production deployment as ${productionHosts[0]}.`,
      );
    }
  }
  const deployment = JSON.parse(vercel("api", `/v13/deployments/${inspection.id}`, "--raw"));
  if (deployment.meta?.gitCommitSha !== commit || deployment.meta?.gitDirty === "1") {
    throw new Error(
      `Production provenance mismatch: expected clean ${commit}, found ${deployment.meta?.gitCommitSha || "no commit"} dirty=${deployment.meta?.gitDirty || "unset"}.`,
    );
  }

  const rootResponse = await fetchWithRetry(`${canonicalOrigin}/`);
  const html = await rootResponse.text();
  assertCleanCopy(html, "Production HTML");
  const { bundlePath } = assertStartupShell(html, "Production HTML");
  if (!/no-store/i.test(rootResponse.headers.get("cache-control") || "")) {
    throw new Error("Production root HTML is not no-store.");
  }
  const expectedBundleUrl = new URL(bundlePath, canonicalOrigin).href;
  const bundleResponse = await fetchWithRetry(expectedBundleUrl);
  assertExecutableJavaScriptResponse(bundleResponse, expectedBundleUrl, "Production hashed Expo bundle");
  const bundle = await bundleResponse.text();
  if (bundle.length === 0) throw new Error("The production hashed Expo bundle is empty.");
  assertCleanCopy(bundle, "Production JavaScript");
  if (!/immutable/i.test(bundleResponse.headers.get("cache-control") || "")) {
    throw new Error("The production hashed Expo bundle is not immutable.");
  }

  const oldAssetResponse = await fetch(`${canonicalOrigin}${knownWithdrawnAsset}`, {
    redirect: "follow",
    cache: "no-store",
  });
  if (oldAssetResponse.ok) {
    assertCleanCopy(await oldAssetResponse.text(), "Former public bundle URL");
  }

  for (const route of ["support", "delete-account", "user-guide", "legal?doc=privacy"] ) {
    const response = await fetchWithRetry(`${canonicalOrigin}/${route}`);
    if (!/no-store/i.test(response.headers.get("cache-control") || "")) {
      throw new Error(`/${route} does not return fresh SPA HTML.`);
    }
    assertCleanCopy(await response.text(), `/${route}`);
  }

  const pdfResponse = await fetchWithRetry(`${canonicalOrigin}/FlowLedger-User-Guide.pdf`);
  if (!/no-store/i.test(pdfResponse.headers.get("cache-control") || "")) {
    throw new Error("The production user-guide PDF is not no-store.");
  }
  const livePdf = Buffer.from(await pdfResponse.arrayBuffer());
  const localPdf = fs.readFileSync(
    path.join(root, "artifacts", "mobile", "public", "FlowLedger-User-Guide.pdf"),
  );
  if (
    crypto.createHash("sha256").update(livePdf).digest("hex")
    !== crypto.createHash("sha256").update(localPdf).digest("hex")
  ) {
    throw new Error("The production user-guide PDF does not match the verified release artifact.");
  }

  console.log(`Production postflight passed: ${inspection.id} at clean commit ${commit}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

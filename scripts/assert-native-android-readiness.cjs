const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const expected = String(process.env.FLOWLEDGER_PLAY_APP_SIGNING_SHA256 || "")
  .trim()
  .toUpperCase();
const fingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

if (!fingerprintPattern.test(expected)) {
  throw new Error(
    "Set FLOWLEDGER_PLAY_APP_SIGNING_SHA256 to the verified Google Play App Signing SHA-256 fingerprint.",
  );
}

const assetLinksPath = path.join(
  root,
  "artifacts",
  "mobile",
  "public",
  ".well-known",
  "assetlinks.json",
);
const statements = JSON.parse(fs.readFileSync(assetLinksPath, "utf8"));
const fingerprints = statements
  .filter(statement => statement?.target?.package_name === "com.flowledger.app")
  .flatMap(statement => statement.target.sha256_cert_fingerprints || [])
  .map(value => String(value).toUpperCase());

if (!fingerprints.includes(expected)) {
  throw new Error(
    "assetlinks.json does not publish the verified Google Play App Signing fingerprint.",
  );
}

console.log("Android App Links include the verified Google Play App Signing fingerprint.");

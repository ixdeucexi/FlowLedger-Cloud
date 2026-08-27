const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "artifacts", "mobile", "lib", "userGuideContent.json");
const pdfPath = path.join(root, "artifacts", "mobile", "public", "FlowLedger-User-Guide.pdf");

const builderPath = path.join(root, "scripts", "build-user-guide.py");
const expectedHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(catalogPath))
  .update(Buffer.from([0]))
  .update(fs.readFileSync(builderPath))
  .digest("hex");
const pdfBytes = fs.readFileSync(pdfPath).toString("latin1");
const embeddedHash = pdfBytes.match(/FlowLedgerGuideSourceSHA256:([a-f0-9]{64})/)?.[1];

if (embeddedHash !== expectedHash) {
  throw new Error(
    "The public user-guide PDF is stale. Run `python scripts/build-user-guide.py` and review the rendered pages.",
  );
}

console.log(`User-guide PDF matches catalog and renderer ${expectedHash.slice(0, 12)}.`);

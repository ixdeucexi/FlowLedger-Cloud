const fs = require("node:fs");
const path = require("node:path");
const {
  assertRegularNonemptyFileBelow,
  assertStartupShell,
} = require("./startup-shell-contract.cjs");

const root = path.resolve(__dirname, "..");
const webDist = path.join(root, "artifacts", "mobile", "dist");
const guidePdf = path.join(root, "artifacts", "mobile", "public", "FlowLedger-User-Guide.pdf");
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

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(target));
    else files.push(target);
  }
  return files;
}

const webFiles = filesBelow(webDist).filter(file => /\.(?:html|js)$/i.test(file));
if (!webFiles.some(file => /\.js$/i.test(file))) {
  throw new Error("No exported Expo web JavaScript was found. Export the production PWA before artifact checks.");
}

const webIndexPath = path.join(webDist, "index.html");
if (!fs.existsSync(webIndexPath)) {
  throw new Error("The exported PWA index.html is missing.");
}
const webIndex = fs.readFileSync(webIndexPath, "utf8");
const { bundlePath } = assertStartupShell(webIndex, "Exported PWA index.html");
const bundleFile = path.resolve(webDist, ...bundlePath.slice(1).split("/"));
assertRegularNonemptyFileBelow(webDist, bundleFile, `Exported PWA entry bundle ${bundlePath}`);

const targets = [...webFiles, guidePdf];
for (const target of targets) {
  const content = fs.readFileSync(target).toString("latin1");
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`Withdrawn or stale release copy ${pattern} remains in ${path.relative(root, target)}.`);
    }
  }
}

console.log(`Release copy scan passed across ${webFiles.length} web artifacts and the public guide.`);

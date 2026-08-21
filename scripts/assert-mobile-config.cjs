const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mobile = path.join(root, "artifacts", "mobile");

assert.equal(fs.existsSync(path.join(root, "app.json")), false, "Root app.json is stale; artifacts/mobile/app.config.js is authoritative.");
assert.equal(fs.existsSync(path.join(root, "eas.json")), false, "Root eas.json is stale; artifacts/mobile/eas.json is authoritative.");

const configPath = path.join(mobile, "app.config.js");
const easPath = path.join(mobile, "eas.json");
assert.equal(fs.existsSync(configPath), true, "Missing artifacts/mobile/app.config.js");
assert.equal(fs.existsSync(easPath), true, "Missing artifacts/mobile/eas.json");

const config = fs.readFileSync(configPath, "utf8");
assert.match(config, /bundleIdentifier:\s*"com\.flowledger\.app"/);
assert.match(config, /package:\s*"com\.flowledger\.app"/);
assert.match(config, /projectId:\s*"80ec219d-8a12-43f9-b7cf-0dd6541e60f1"/);
assert.match(config, /android-adaptive-foreground\.png/);
assert.match(config, /android-monochrome\.png/);

const serverSource = fs.readFileSync(path.join(mobile, "server", "serve.js"), "utf8");
assert.match(serverSource, /app\.config\.js/, "Static server must read the authoritative app.config.js.");
assert.doesNotMatch(serverSource, /app\.json/, "Static server must not read a removed app.json.");

for (const file of ["icon.png", "android-adaptive-foreground.png", "android-monochrome.png", "startup_f_transparent.png"]) {
  const target = path.join(mobile, "assets", "images", file);
  assert.equal(fs.existsSync(target), true, `Missing release image: ${file}`);
  assert.ok(fs.statSync(target).size > 0, `Release image is empty: ${file}`);
}

for (const file of ["android-adaptive-foreground.png", "android-monochrome.png"]) {
  const bytes = fs.readFileSync(path.join(mobile, "assets", "images", file));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${file} must be a PNG.`);
  assert.equal(bytes.readUInt32BE(16), 1024, `${file} must be 1024 px wide.`);
  assert.equal(bytes.readUInt32BE(20), 1024, `${file} must be 1024 px tall.`);
  assert.ok([4, 6].includes(bytes[25]), `${file} must have an alpha channel.`);
}

const eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
assert.equal(eas.cli?.version, "20.0.0");
assert.equal(eas.cli?.appVersionSource, "remote");
assert.equal(eas.build?.production?.android?.buildType, "app-bundle");

console.log("Mobile config authority and required release assets are consistent.");

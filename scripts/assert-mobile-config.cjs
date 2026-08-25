const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const mobile = path.join(root, "artifacts", "mobile");

assert.equal(fs.existsSync(path.join(root, "app.json")), false, "Root app.json is stale; artifacts/mobile/app.config.js is authoritative.");
assert.equal(fs.existsSync(path.join(root, "eas.json")), false, "Root eas.json is stale; artifacts/mobile/eas.json is authoritative.");

const configPath = path.join(mobile, "app.config.js");
const easPath = path.join(mobile, "eas.json");
const assetLinksPath = path.join(mobile, "public", ".well-known", "assetlinks.json");
assert.equal(fs.existsSync(configPath), true, "Missing artifacts/mobile/app.config.js");
assert.equal(fs.existsSync(easPath), true, "Missing artifacts/mobile/eas.json");
assert.equal(fs.existsSync(assetLinksPath), true, "Missing Android Digital Asset Links statement.");

const config = fs.readFileSync(configPath, "utf8");
assert.match(config, /bundleIdentifier:\s*"com\.flowledger\.app"/);
assert.match(config, /package:\s*"com\.flowledger\.app"/);
assert.match(config, /projectId:\s*"80ec219d-8a12-43f9-b7cf-0dd6541e60f1"/);
assert.match(config, /android-adaptive-foreground\.png/);
assert.match(config, /android-monochrome\.png/);
assert.match(config, /expo-notifications/);
assert.match(config, /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY/);
assert.match(config, /EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY/);
assert.match(config, /EXPO_PUBLIC_BILLING_ENVIRONMENT/);
assert.match(config, /paidLaunch && billingEnvironment !== "production"/);
assert.match(config, /EXPO_PUBLIC_LAUNCH_MODE/);
assert.match(config, /configuredAppEnvironment !== "production"/);
assert.match(config, /revenueCatIosApiKey/);
assert.match(config, /revenueCatAndroidApiKey/);
assert.match(config, /googleServicesFile/);
assert.match(config, /GOOGLE_SERVICES_JSON/);

const productionWithoutAppEnvironment = spawnSync(process.execPath, ["-e", "require('./artifacts/mobile/app.config.js')"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    EAS_BUILD_PROFILE: "production",
    EAS_BUILD_PLATFORM: "android",
    EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    EXPO_PUBLIC_API_ORIGIN: "https://flowledger-algo.com",
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "appl_test",
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: "goog_test",
    EXPO_PUBLIC_BILLING_ENVIRONMENT: "production",
    EXPO_PUBLIC_APPLE_AUTH_ENABLED: "true",
    GOOGLE_SERVICES_JSON: "C:/eas-secret/google-services.json",
    EXPO_PUBLIC_APP_ENVIRONMENT: "",
  },
});
assert.notEqual(productionWithoutAppEnvironment.status, 0, "A production build must fail when EXPO_PUBLIC_APP_ENVIRONMENT is missing.");
assert.match(productionWithoutAppEnvironment.stderr, /EXPO_PUBLIC_APP_ENVIRONMENT=production/);

function productionConfig(overrides) {
  return spawnSync(process.execPath, ["-e", "require('./artifacts/mobile/app.config.js')"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "android",
      EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      EXPO_PUBLIC_API_ORIGIN: "https://flowledger-algo.com",
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "appl_test",
      EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: "goog_test",
      EXPO_PUBLIC_BILLING_ENVIRONMENT: "production",
      EXPO_PUBLIC_APPLE_AUTH_ENABLED: "true",
      EXPO_PUBLIC_APP_ENVIRONMENT: "production",
      GOOGLE_SERVICES_JSON: "C:/eas-secret/google-services.json",
      ...overrides,
    },
  });
}

for (const badOrigin of ["http://flowledger-algo.com", "https://preview.flowledger-algo.com", "https://flowledger-algo.com/api", "https://user@flowledger-algo.com"]) {
  assert.notEqual(productionConfig({ EXPO_PUBLIC_API_ORIGIN: badOrigin }).status, 0, `Production must reject API origin ${badOrigin}`);
}
for (const badSupabase of ["http://example.supabase.co", "https://example.supabase.co/rest", "https://example.invalid", "https://user@example.supabase.co"]) {
  assert.notEqual(productionConfig({ EXPO_PUBLIC_SUPABASE_URL: badSupabase }).status, 0, `Production must reject Supabase URL ${badSupabase}`);
}
assert.notEqual(productionConfig({ GOOGLE_SERVICES_JSON: "" }).status, 0, "Production Android push must require the Firebase client config file path.");
assert.equal(productionConfig({}).status, 0, "A complete canonical production configuration must load.");
assert.equal(productionConfig({
  EXPO_PUBLIC_APPLE_AUTH_ENABLED: "",
}).status, 0, "Android production must not require the iOS-only Apple provider.");
assert.notEqual(productionConfig({
  EAS_BUILD_PLATFORM: "ios",
  EXPO_PUBLIC_APPLE_AUTH_ENABLED: "",
}).status, 0, "iOS production must require the configured Apple provider.");
assert.equal(productionConfig({
  EXPO_PUBLIC_LAUNCH_MODE: "free",
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "",
  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: "",
  EXPO_PUBLIC_BILLING_ENVIRONMENT: "sandbox",
}).status, 0, "Founding Free production must not require store billing credentials.");
assert.notEqual(productionConfig({
  EXPO_PUBLIC_LAUNCH_MODE: "paid",
  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: "",
}).status, 0, "Paid production must fail without store billing credentials.");

const mobilePackage = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
assert.equal(mobilePackage.dependencies?.["react-native-purchases"], "10.7.2");
assert.equal(mobilePackage.dependencies?.["react-native-plaid-link-sdk"], "13.0.4");
assert.equal(mobilePackage.dependencies?.["expo-notifications"], "~0.32.17");
assert.deepEqual(mobilePackage.expo?.doctor?.reactNativeDirectoryCheck?.exclude, ["react-native-plaid-link-sdk"]);
assert.equal(mobilePackage.dependencies?.["expo-location"], undefined);
assert.equal(mobilePackage.dependencies?.["expo-image-picker"], undefined);

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

const featureGraphic = fs.readFileSync(path.join(root, "store-assets", "v1", "google-play", "feature-graphic-1024x500.png"));
assert.equal(featureGraphic.toString("ascii", 1, 4), "PNG", "Feature graphic must be PNG.");
assert.equal(featureGraphic.readUInt32BE(16), 1024, "Feature graphic must be 1024 px wide.");
assert.equal(featureGraphic.readUInt32BE(20), 500, "Feature graphic must be 500 px tall.");
assert.equal(featureGraphic[25], 2, "Feature graphic must be RGB without alpha.");

const storeManifest = JSON.parse(fs.readFileSync(path.join(root, "store-assets", "v1", "manifest.json"), "utf8"));
assert.equal(storeManifest.fictionalDataOnly, true);
assert.equal(storeManifest.featureGraphic.logo, "../../artifacts/mobile/assets/images/startup_f_transparent.png");
assert.equal(crypto.createHash("sha256").update(featureGraphic).digest("hex").toUpperCase(), storeManifest.featureGraphic.sha256);
const featureLogo = fs.readFileSync(path.join(mobile, "assets", "images", "startup_f_transparent.png"));
assert.equal(crypto.createHash("sha256").update(featureLogo).digest("hex").toUpperCase(), storeManifest.featureGraphic.logoSha256);

const eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
assert.equal(eas.cli?.version, "20.0.0");
assert.equal(eas.cli?.appVersionSource, "remote");
assert.equal(eas.build?.production?.android?.buildType, "app-bundle");

const assetLinks = JSON.parse(fs.readFileSync(assetLinksPath, "utf8"));
assert.deepEqual(assetLinks[0]?.relation, ["delegate_permission/common.handle_all_urls"]);
assert.equal(assetLinks[0]?.target?.namespace, "android_app");
assert.equal(assetLinks[0]?.target?.package_name, "com.flowledger.app");
assert.match(
  assetLinks[0]?.target?.sha256_cert_fingerprints?.[0] ?? "",
  /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
  "Android App Links require a complete SHA-256 signing-certificate fingerprint.",
);

console.log("Mobile config authority and required release assets are consistent.");

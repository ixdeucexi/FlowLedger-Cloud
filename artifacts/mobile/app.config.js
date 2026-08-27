const PRODUCTION_ORIGIN = "https://flowledger-algo.com";
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";
const isEasBuild = Boolean(process.env.EAS_BUILD_PROFILE);
const isIosEasBuild = process.env.EAS_BUILD_PLATFORM === "ios";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN;
const appleAuthEnabled = process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED === "true";
const revenueCatIosApiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const revenueCatAndroidApiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const billingEnvironment = process.env.EXPO_PUBLIC_BILLING_ENVIRONMENT || "sandbox";
const launchMode = process.env.EXPO_PUBLIC_LAUNCH_MODE || "free";
const paidLaunch = launchMode === "paid";
const configuredAppEnvironment = process.env.EXPO_PUBLIC_APP_ENVIRONMENT;
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const appEnvironment = configuredAppEnvironment || "development";

if (isEasBuild) {
  const missingRuntimeValues = [
    ["EXPO_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["EXPO_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
    ["EXPO_PUBLIC_API_ORIGIN", apiOrigin],
  ].filter(([, value]) => !value);
  if (missingRuntimeValues.length) {
    throw new Error(`EAS builds require explicit runtime configuration: ${missingRuntimeValues.map(([name]) => name).join(", ")}`);
  }
  if (!isProductionEasBuild && apiOrigin === PRODUCTION_ORIGIN) {
    throw new Error("Preview EAS builds cannot target the production API origin.");
  }
}

if (isProductionEasBuild) {
  const invalid = [
    ["EXPO_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["EXPO_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
    ["EXPO_PUBLIC_API_ORIGIN", process.env.EXPO_PUBLIC_API_ORIGIN],
    ["GOOGLE_SERVICES_JSON", googleServicesFile],
    ...(paidLaunch ? [
      ["EXPO_PUBLIC_REVENUECAT_IOS_API_KEY", revenueCatIosApiKey],
      ["EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY", revenueCatAndroidApiKey],
    ] : []),
  ].filter(([, value]) => !value || /localhost|127\.0\.0\.1|replit/i.test(value));
  if (invalid.length) {
    throw new Error(`Production EAS build is missing safe environment values: ${invalid.map(([name]) => name).join(", ")}`);
  }
  let parsedApiOrigin;
  let parsedSupabaseUrl;
  try {
    parsedApiOrigin = new URL(process.env.EXPO_PUBLIC_API_ORIGIN);
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("Production EAS builds require valid HTTPS API and Supabase URLs.");
  }
  if (
    parsedApiOrigin.origin !== PRODUCTION_ORIGIN
    || parsedApiOrigin.href !== `${PRODUCTION_ORIGIN}/`
    || parsedApiOrigin.username
    || parsedApiOrigin.password
  ) throw new Error(`Production EAS builds require EXPO_PUBLIC_API_ORIGIN=${PRODUCTION_ORIGIN}.`);
  if (
    parsedSupabaseUrl.protocol !== "https:"
    || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsedSupabaseUrl.hostname)
    || parsedSupabaseUrl.pathname !== "/"
    || parsedSupabaseUrl.search
    || parsedSupabaseUrl.hash
    || parsedSupabaseUrl.username
    || parsedSupabaseUrl.password
  ) throw new Error("Production EAS builds require an HTTPS project URL on *.supabase.co with no path or credentials.");
  if (paidLaunch && billingEnvironment !== "production") throw new Error("Paid production EAS builds require EXPO_PUBLIC_BILLING_ENVIRONMENT=production.");
  if (configuredAppEnvironment !== "production") throw new Error("Production EAS builds require EXPO_PUBLIC_APP_ENVIRONMENT=production.");
  if (isIosEasBuild && !appleAuthEnabled) throw new Error("Production iOS readiness requires EXPO_PUBLIC_APPLE_AUTH_ENABLED=true after the Supabase Apple provider is configured.");
}

module.exports = {
  expo: {
    name: "FlowLedger",
    slug: "mobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "flowledger",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    updates: { enabled: false },
    splash: {
      image: "./assets/images/startup_f_transparent.png",
      resizeMode: "contain",
      backgroundColor: "#050816",
    },
    ios: {
      bundleIdentifier: "com.flowledger.app",
      supportsTablet: false,
      usesAppleSignIn: true,
      associatedDomains: ["applinks:flowledger-algo.com"],
    },
    android: {
      package: "com.flowledger.app",
      googleServicesFile,
      versionCode: 1,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: "flowledger-algo.com", pathPrefix: "/" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/images/android-adaptive-foreground.png",
        monochromeImage: "./assets/images/android-monochrome.png",
        backgroundColor: "#050816",
      },
    },
    web: { favicon: "./assets/images/icon.png" },
    plugins: [
      ["expo-build-properties", { android: { minSdkVersion: 26 } }],
      ["expo-router", { origin: PRODUCTION_ORIGIN }],
      "expo-font",
      "expo-web-browser",
      "expo-apple-authentication",
      ["expo-secure-store", { configureAndroidBackup: true }],
      ["expo-local-authentication", { faceIDPermission: "Allow FlowLedger to use Face ID to protect your financial plan." }],
      ["expo-notifications", { icon: "./assets/images/android-monochrome.png", color: "#9B5CFF", defaultChannel: "flowledger-alerts" }],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      apiOrigin,
      appleAuthEnabled,
      revenueCatIosApiKey,
      revenueCatAndroidApiKey,
      billingEnvironment,
      launchMode,
      appEnvironment,
      eas: { projectId: "80ec219d-8a12-43f9-b7cf-0dd6541e60f1" },
    },
  },
};

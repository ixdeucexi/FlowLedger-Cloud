const PRODUCTION_ORIGIN = "https://flowledger-algo.com";
const isProductionEasBuild = process.env.EAS_BUILD_PROFILE === "production";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || PRODUCTION_ORIGIN;
const appleAuthEnabled = process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED === "true";

if (isProductionEasBuild) {
  const invalid = [
    ["EXPO_PUBLIC_SUPABASE_URL", supabaseUrl],
    ["EXPO_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
    ["EXPO_PUBLIC_API_ORIGIN", process.env.EXPO_PUBLIC_API_ORIGIN],
  ].filter(([, value]) => !value || /localhost|127\.0\.0\.1|replit/i.test(value));
  if (invalid.length) {
    throw new Error(`Production EAS build is missing safe environment values: ${invalid.map(([name]) => name).join(", ")}`);
  }
  if (!appleAuthEnabled) throw new Error("Production iOS readiness requires EXPO_PUBLIC_APPLE_AUTH_ENABLED=true after the Supabase Apple provider is configured.");
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
      ["expo-router", { origin: PRODUCTION_ORIGIN }],
      "expo-font",
      "expo-web-browser",
      "expo-apple-authentication",
      ["expo-secure-store", { configureAndroidBackup: true }],
      ["expo-local-authentication", { faceIDPermission: "Allow FlowLedger to use Face ID to protect your financial plan." }],
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
      eas: { projectId: "80ec219d-8a12-43f9-b7cf-0dd6541e60f1" },
    },
  },
};

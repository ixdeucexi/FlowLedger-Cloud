module.exports = {
  expo: {
    name: "FlowLedger",
    slug: "mobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "mobile",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    updates: { enabled: false },
    splash: {
      image: "./assets/images/startup_f_transparent.png",
      resizeMode: "contain",
      backgroundColor: "#050816",
    },
    ios: { supportsTablet: false },
    android: {
      package: "com.flowledger.app",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#050816",
      },
    },
    web: { favicon: "./assets/images/icon.png" },
    plugins: [
      ["expo-router", { origin: "https://replit.com/" }],
      "expo-font",
      "expo-web-browser",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      supabaseUrl:      process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey:  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: { projectId: "80ec219d-8a12-43f9-b7cf-0dd6541e60f1" },
    },
  },
};

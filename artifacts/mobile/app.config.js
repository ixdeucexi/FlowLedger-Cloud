const SUPABASE_URL  = process.env.EXPO_PUBLIC_SUPABASE_URL  ?? "https://imqmhfdquqlqxgtcdbvc.supabase.co";
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltcW1oZmRxdXFscXhndGNkYnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTcwMTIsImV4cCI6MjA5NjU3MzAxMn0.lcjjNxrhhip6ZQfyk2qfTSZA8blN2ipNJYFAbCbeSp0";

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
      image: "./assets/images/icon.png",
      resizeMode: "contain",
      backgroundColor: "#0f9b8e",
    },
    ios: { supportsTablet: false },
    android: {
      package: "com.flowledger.app",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#0a0e1a",
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
      supabaseUrl:     SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON,
      eas: { projectId: "80ec219d-8a12-43f9-b7cf-0dd6541e60f1" },
    },
  },
};

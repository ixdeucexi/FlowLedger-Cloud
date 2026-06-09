const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Block whatwg-fetch/cross-fetch polyfills so Supabase uses React Native's
// native fetch implementation instead of the browser XHR polyfill (which
// fails on iOS with "Network request failed").
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "cross-fetch" || moduleName === "whatwg-fetch") {
    return { type: "empty" };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

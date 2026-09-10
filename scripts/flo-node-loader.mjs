// Test-only resolver for Edge npm: imports and the shared Expo extensionless
// TypeScript graph. Production Edge files are packaged with explicit paths.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("npm:")) {
    const bare=specifier.slice(4).replace(/@[^/@]+$/, "");
    return nextResolve(bare,context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`,context); } catch {}
  }
  return nextResolve(specifier,context);
} });

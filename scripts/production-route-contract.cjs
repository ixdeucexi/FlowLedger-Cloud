const fs = require("node:fs");
const path = require("node:path");
const requiredAppRoutes = Object.freeze([
  { url: "/support", module: "./support.tsx" },
  { url: "/delete-account", module: "./delete-account.tsx" },
  { url: "/user-guide", module: "./user-guide.tsx" },
  { url: "/legal?doc=privacy", module: "./legal.tsx" },
]);
function assertAppRouteSources(root) {
  for (const route of requiredAppRoutes) {
    const file = path.join(root, "artifacts", "mobile", "app", route.module);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.readFileSync(file, "utf8").trim()) {
      throw new Error(`Required public route ${route.url} has no application module (${route.module}); SPA fallback HTML is not route validation.`);
    }
  }
}
function assertRegisteredAppRoute(route, bundle) {
  const escaped = route.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Require an Expo context registration, not incidental route text in a menu or error.
  const registration = new RegExp(`["']${escaped}["']\\s*:\\s*\\{\\s*enumerable\\s*:`);
  if (!registration.test(bundle)) throw new Error(`${route.url} is not registered in the deployed Expo bundle. A 200 SPA response is insufficient.`);
}
async function assertHealthResponse(response) {
  if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get("content-type") || "") || !/no-store/i.test(response.headers.get("cache-control") || "")) throw new Error("/api/healthz must return fresh HTTP 200 JSON, not SPA HTML.");
  const value = await response.json();
  if (!value || value.status !== "ok" || Object.keys(value).length !== 1) throw new Error("/api/healthz does not match the liveness API contract.");
}
function assertMissingResource(response, label) {
  if (![404, 410].includes(response.status)) throw new Error(`${label} must fail as a missing resource, not return HTTP ${response.status} or SPA HTML.`);
}
module.exports = { requiredAppRoutes, assertAppRouteSources, assertRegisteredAppRoute, assertHealthResponse, assertMissingResource };

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requiredAppRoutes, assertAppRouteSources, assertRegisteredAppRoute, assertHealthResponse, assertMissingResource } = require("./production-route-contract.cjs");
test("SPA success and incidental route text cannot prove a required route exists", () => {
  for (const route of requiredAppRoutes) {
    assert.throws(() => assertRegisteredAppRoute(route, '<html>FlowLedger</html>'), /not registered/);
    assert.throws(() => assertRegisteredAppRoute(route, `const route="${route.module}";`), /not registered/);
    assert.doesNotThrow(() => assertRegisteredAppRoute(route, `"${route.module}":{enumerable:!0,get:()=>r(d[25])}`));
    assert.throws(() => assertRegisteredAppRoute(route, '"./not-the-required-route.tsx":{enumerable:!0,get:()=>r(d[25])}'), /not registered/);
  }
});
test("temporary gate defers legal/privacy without claiming those routes are verified", () => {
  assert.deepEqual(requiredAppRoutes.map(route => route.url), ["/support", "/delete-account", "/user-guide"]);
  assert.equal(requiredAppRoutes.some(route => /legal|privacy/.test(route.url)), false);
  assert.doesNotThrow(() => assertAppRouteSources(path.join(__dirname, "..")));
  const configCheck = fs.readFileSync(path.join(__dirname, "assert-mobile-config.cjs"), "utf8");
  assert.doesNotMatch(configCheck, /for \(const route of \[[^\]]*"legal"/);
});
test("absent source tree is rejected rather than inferred from a SPA shell", () => {
  assert.throws(() => assertAppRouteSources(path.join(__dirname, "absent-source-fixture")), /no application module/);
});
test("health JSON contract rejects HTML, stale responses and extra private fields", async () => {
  const response = (body, type = "application/json", cache = "no-store") => new Response(body, { headers: { "content-type": type, "cache-control": cache } });
  await assertHealthResponse(response('{"status":"ok"}'));
  await assert.rejects(() => assertHealthResponse(response('<html>App</html>', "text/html")), /JSON/);
  await assert.rejects(() => assertHealthResponse(response('{"status":"ok"}', "application/json", "public")), /JSON/);
  await assert.rejects(() => assertHealthResponse(response('{"status":"ok","secret":"x"}')), /contract/);
});
test("missing API and bundle probes reject soft 200 and redirects", () => {
  for (const status of [200, 301, 302, 500]) assert.throws(() => assertMissingResource({ status }, "probe"), /missing resource/);
  for (const status of [404, 410]) assert.doesNotThrow(() => assertMissingResource({ status }, "probe"));
});
test("Vercel SPA fallback excludes API and Expo assets without blocking app routes", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const fallback = config.rewrites.find(r => r.destination === "/index.html");
  const pattern = new RegExp(`^/${fallback.source.slice("/:path(".length, -1)}$`);
  for (const route of ["/", "/bills", "/auth/callback", "/delete-account", "/legal"]) assert.equal(pattern.test(route), true, route);
  for (const route of ["/api", "/api/healthz", "/api/does-not-exist", "/_expo/static/js/missing.js", "/_expo"]) assert.equal(pattern.test(route), false, route);
  assert.ok(config.headers.find(r => r.source === "/push-sw.js").headers.some(h => h.key === "Cache-Control" && h.value === "no-store"));
});

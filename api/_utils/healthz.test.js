const test = require("node:test");
const assert = require("node:assert/strict");
const healthz = require("./healthz");
function call(method) {
  const result = { headers: {} };
  const res = { setHeader(key, value) { result.headers[key] = value; }, status(status) { result.status = status; return res; }, json(body) { result.body = body; return result; } };
  return healthz({ method }, res);
}
test("Vercel health endpoint returns the API contract without configuration or data reads", () => {
  const result = call("GET");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: "ok" });
  assert.match(result.headers["Content-Type"], /^application\/json/);
  assert.equal(result.headers["Cache-Control"], "no-store");
});
test("health does not accept mutations", () => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const result = call(method);
    assert.equal(result.status, 405); assert.equal(result.headers.Allow, "GET");
    assert.deepEqual(result.body, { error: "METHOD_NOT_ALLOWED" });
  }
});
test("health is dispatched before account/auth work without adding a Vercel function", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "feedback.js"), "utf8");
  assert.match(source, /if \(req.query\?\.healthz === "1"\) return healthz\(req, res\)/);
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "vercel.json"), "utf8"));
  assert.deepEqual(config.rewrites.find(r => r.source === "/api/healthz"), { source: "/api/healthz", destination: "/api/feedback?healthz=1" });
  assert.equal(fs.existsSync(path.join(__dirname, "..", "healthz.js")), false);
});

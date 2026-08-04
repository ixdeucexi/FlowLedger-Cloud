const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const configPromise = readFile(path.join(__dirname, "..", "..", "vercel.json"), "utf8")
  .then(contents => JSON.parse(contents));

test("browser traffic is redirected to the canonical biometric domain", async () => {
  const config = await configPromise;
  const redirectsByHost = new Map(
    config.redirects.map(redirect => [redirect.has?.[0]?.value, redirect]),
  );

  for (const hostname of ["www.flowledger-algo.com", "flow-ledger-cloud.vercel.app"]) {
    const redirect = redirectsByHost.get(hostname);
    assert.ok(redirect, `missing canonical redirect for ${hostname}`);
    assert.equal(redirect.source, "/:path((?!api/).*)");
    assert.equal(redirect.destination, "https://flowledger-algo.com/:path*");
    assert.equal(redirect.permanent, true);
  }
});

test("canonical redirects leave API routes available on their configured host", async () => {
  const config = await configPromise;
  for (const redirect of config.redirects) {
    assert.match(redirect.source, /\(\?!api\/\)/);
  }
});

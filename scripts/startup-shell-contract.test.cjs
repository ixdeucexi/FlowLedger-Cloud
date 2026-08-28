const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertExecutableJavaScriptResponse,
  assertRegularNonemptyFileBelow,
  assertStartupShell,
} = require("./startup-shell-contract.cjs");

const sourcePath = path.resolve(__dirname, "..", "artifacts", "mobile", "public", "index.html");
const source = fs.readFileSync(sourcePath, "utf8");
const valid = source
  .replace("  </head>", '  <link rel="icon" href="/favicon.ico" /></head>')
  .replace(
    "  </body>",
    '  <script src="/_expo/static/js/web/entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js" defer></script>\n</body>',
  );

test("the release shell contract accepts the real template structure", () => {
  assert.deepEqual(assertStartupShell(valid, "fixture"), {
    bundlePath: "/_expo/static/js/web/entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js",
  });
});

test("commented-out atomic hiding cannot satisfy the release shell contract", () => {
  const malformed = valid
    .replace("display: none !important;", "display: flex;")
    .replace("</head>", "<!-- display: none !important; transition: none; --></head>");
  assert.throws(() => assertStartupShell(malformed, "fixture"), /startup CSS|must declare display/);
});

test("a commented inert root cannot satisfy the release shell contract", () => {
  const malformed = valid
    .replace('<div id="root" inert aria-hidden="true"></div>', '<div id="root"></div>')
    .replace("</body>", '<!-- <div id="root" inert aria-hidden="true"></div> --></body>');
  assert.throws(() => assertStartupShell(malformed, "fixture"), /must have inert/);
});

test("the controller must precede a real deferred bundle element", () => {
  const bundle = '<script src="/_expo/static/js/web/entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js" defer></script>';
  const malformed = valid.replace(bundle, "").replace("<body>", `<body>${bundle}`);
  assert.throws(() => assertStartupShell(malformed, "fixture"), /first direct body element|before the deferred Expo bundle/);

  const nonDeferred = valid.replace(
    "entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js\" defer",
    "entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js\"",
  );
  assert.throws(() => assertStartupShell(nonDeferred, "fixture"), /must have defer/);
});

test("commented or string-only rearm statements cannot satisfy the controller contract", () => {
  const commentedInert = valid.replace(
    'root.setAttribute("inert", "");',
    '// root.setAttribute("inert", "");',
  );
  assert.throws(
    () => assertStartupShell(commentedInert, "fixture"),
    /executable release contract|missing an executable cover\/root barrier statement/,
  );

  const stringOnlyCover = valid.replace(
    "cover.hidden = false;",
    'const disabledCoverStatement = "cover.hidden = false;";',
  );
  assert.throws(
    () => assertStartupShell(stringOnlyCover, "fixture"),
    /executable release contract|missing an executable cover\/root barrier statement/,
  );
});

test("inactive containers and startup-style overrides fail closed", () => {
  const rootInNoscript = valid
    .replace('<div id="root" inert aria-hidden="true"></div>', "")
    .replace("</noscript>", '<div id="root" inert aria-hidden="true"></div></noscript>');
  assert.throws(
    () => assertStartupShell(rootInNoscript, "fixture"),
    /noscript fallback|root must follow|controller must directly/,
  );

  const hiddenCover = valid.replace(
    'id="flowledger-web-startup-cover"',
    'id="flowledger-web-startup-cover" hidden',
  );
  assert.throws(() => assertStartupShell(hiddenCover, "fixture"), /cannot begin hidden/);

  const inactiveStyle = valid.replace('<style id="expo-reset">', '<style id="expo-reset" media="not all">');
  assert.throws(() => assertStartupShell(inactiveStyle, "fixture"), /does not match the reviewed active release contract/);
});

test("unreviewed controller flow and non-executable or duplicate bundles fail closed", () => {
  const earlyReturn = valid.replace("const arm = (reason) => {", "const arm = (reason) => { return;");
  assert.throws(() => assertStartupShell(earlyReturn, "fixture"), /does not match the reviewed executable release contract/);

  const jsonBundle = valid.replace(
    '<script src="/_expo/static/js/web/entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js" defer>',
    '<script src="/_expo/static/js/web/entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js" type="application/json" defer>',
  );
  assert.throws(() => assertStartupShell(jsonBundle, "fixture"), /directly executable deferred script/);

  const duplicateBundle = valid.replace(
    "</body>",
    '<script src="/_expo/static/js/web/entry-deadbeefdeadbeefdeadbeefdeadbeef.js" defer></script></body>',
  );
  assert.throws(() => assertStartupShell(duplicateBundle, "fixture"), /exactly one hashed Expo entry bundle/);
});

test("the complete active document rejects unbalanced cover and page-level overrides", () => {
  const unclosedCover = valid.replace("    </div>\n    <noscript>", "    <noscript>");
  assert.throws(() => assertStartupShell(unclosedCover, "fixture"), /reviewed startup release shell/);

  for (const malformed of [
    valid.replace("<body>", '<body hidden style="display:none" inert>'),
    valid.replace("</head>", '<link rel="stylesheet" href="data:text/css,body{display:none}"></head>'),
    valid.replace("</body>", '<script>document.body.hidden=true</script></body>'),
    valid.replace('<html lang="%LANG_ISO_CODE%">', '<html lang="%LANG_ISO_CODE%" hidden>'),
  ]) {
    assert.throws(() => assertStartupShell(malformed, "fixture"), /reviewed startup release shell|first direct body/);
  }
});

test("the optional Cloudflare beacon is accepted only in its reviewed post-bundle slot", () => {
  const beacon = '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v123abc" integrity="sha512-YWJjZA==" data-cf-beacon=\'{"token":"fixture"}\' crossorigin="anonymous"></script>';
  const validWithBeacon = valid.replace("</body>", `${beacon}\n</body>`);
  assert.doesNotThrow(() => assertStartupShell(validWithBeacon, "fixture"));

  for (const malformed of [
    `${beacon}${valid}`,
    valid.replace('<div class="flowledger-web-startup-brand">', `${beacon}<div class="flowledger-web-startup-brand">`),
    `${valid}${beacon}`,
    validWithBeacon.replace(beacon, `\u00a0${beacon}`),
    validWithBeacon.replace(beacon, `\u2003${beacon}`),
    validWithBeacon.replace(beacon, `${beacon}\u00a0`),
    validWithBeacon.replace(beacon, `${beacon}\u2003`),
  ]) {
    assert.throws(() => assertStartupShell(malformed, "fixture"), /outside its reviewed post-bundle body slot/);
  }
});

test("entry hashes use the exact Expo format and document boundaries preserve browser parsing mode", () => {
  const shortHash = valid.replace(
    "entry-a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4.js",
    "entry-a.js",
  );
  assert.throws(() => assertStartupShell(shortHash, "fixture"), /exactly one hashed Expo entry bundle/);
  assert.throws(() => assertStartupShell(`\u00a0${valid}`, "fixture"), /reviewed startup release shell/);
  assert.throws(() => assertStartupShell(`\u2003${valid}`, "fixture"), /reviewed startup release shell/);
});

test("artifact containment follows real paths and live bundles cannot redirect or return HTML", t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flowledger-shell-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const dist = path.join(fixtureRoot, "dist");
  const outside = path.join(fixtureRoot, "outside");
  fs.mkdirSync(dist);
  fs.mkdirSync(outside);
  const localBundle = path.join(dist, "entry.js");
  fs.writeFileSync(localBundle, "console.log('ok');");
  assert.equal(assertRegularNonemptyFileBelow(dist, localBundle), fs.realpathSync(localBundle));

  const outsideBundle = path.join(outside, "entry.js");
  fs.writeFileSync(outsideBundle, "console.log('outside');");
  const linkedParent = path.join(dist, "linked");
  fs.symlinkSync(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => assertRegularNonemptyFileBelow(dist, path.join(linkedParent, "entry.js")),
    /physically contained below/,
  );

  const headers = contentType => ({ get: name => name === "content-type" ? contentType : null });
  assert.doesNotThrow(() => assertExecutableJavaScriptResponse({
    url: "https://flowledger-algo.com/entry.js",
    headers: headers("application/javascript; charset=utf-8"),
  }, "https://flowledger-algo.com/entry.js"));
  assert.throws(() => assertExecutableJavaScriptResponse({
    url: "https://other.example/entry.js",
    headers: headers("application/javascript"),
  }, "https://flowledger-algo.com/entry.js"), /redirected/);
  assert.throws(() => assertExecutableJavaScriptResponse({
    url: "https://flowledger-algo.com/entry.js",
    redirected: true,
    headers: headers("application/javascript"),
  }, "https://flowledger-algo.com/entry.js"), /redirected/);
  assert.throws(() => assertExecutableJavaScriptResponse({
    url: "https://flowledger-algo.com/entry.js",
    headers: headers("text/html"),
  }, "https://flowledger-algo.com/entry.js"), /non-JavaScript/);
});

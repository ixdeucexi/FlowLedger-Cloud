const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mobile = path.resolve(__dirname, "../artifacts/mobile");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
  });
}

test("mobile icon imports do not bundle unused icon families through the barrel", () => {
  const sources = ["app", "components", "hooks"].flatMap(dir => sourceFiles(path.join(mobile, dir)));
  const barrelImport = /(?:from\s*|require\(\s*)["']@expo\/vector-icons["']/;
  const offenders = sources.filter(file => barrelImport.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map(file => path.relative(mobile, file)), []);
  assert.ok(sources.some(file => fs.readFileSync(file, "utf8").includes("@expo/vector-icons/Feather")));
});

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const moreHubPath = path.join(
  __dirname,
  "../../artifacts/mobile/components/settings/MoreHub.tsx",
);

test("Settings household identity can wrap at enlarged text sizes", async () => {
  const source = await readFile(moreHubPath, "utf8");

  assert.match(
    source,
    /styles\.householdName[\s\S]*>\{householdName\}<\/Text>/,
  );
  assert.doesNotMatch(
    source,
    /styles\.householdName[\s\S]{0,120}numberOfLines=\{1\}/,
  );
  assert.match(
    source,
    /styles\.identity[\s\S]*>\{identity\}[^<]*\{householdRole\}<\/Text>/,
  );
  assert.doesNotMatch(
    source,
    /styles\.identity[\s\S]{0,120}numberOfLines=\{1\}/,
  );
});

test("Settings theme and text-style choices expose selected button state", async () => {
  const source = await readFile(
    path.join(__dirname, "../../artifacts/mobile/app/(tabs)/more.tsx"),
    "utf8",
  );
  const selectedButtons = source.match(
    /accessibilityRole="button"\s+accessibilityState=\{\{ selected: active \}\}/g,
  ) ?? [];

  assert.equal(selectedButtons.length, 2);
});

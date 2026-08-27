const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const branch = git("branch", "--show-current");
const commit = git("rev-parse", "HEAD");
const status = git("status", "--porcelain=v1", "--untracked-files=all");

if (!branch && !process.env.CI) {
  throw new Error("Release source must be on a named branch, not a detached HEAD.");
}

if (status) {
  const lines = status.split(/\r?\n/);
  throw new Error(
    `Release source is dirty (${lines.length} changed path${lines.length === 1 ? "" : "s"}). Commit the exact verified source before deploying.`,
  );
}

const vercelIgnoreLines = new Set(
  fs.readFileSync(path.join(root, ".vercelignore"), "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean),
);
for (const requiredPattern of ["**/.tmp-tests", "**/.release-dist*/**", "**/.vercel"]) {
  if (!vercelIgnoreLines.has(requiredPattern)) {
    throw new Error(`.vercelignore must exclude local release artifact pattern ${requiredPattern}.`);
  }
}

execFileSync("git", ["diff", "--check", `${commit}^`, commit], {
  stdio: "inherit",
});

console.log(`Release source is clean: ${branch || "CI detached checkout"} @ ${commit}`);

const { execFileSync } = require("node:child_process");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function vercel(...args) {
  if (process.platform === "win32") {
    return execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "vercel", ...args],
      { encoding: "utf8" },
    ).trim();
  }
  return execFileSync("vercel", args, { encoding: "utf8" }).trim();
}

const rollbackRef = process.env.FLOWLEDGER_ROLLBACK_REF?.trim();
if (!rollbackRef || !/^rollback\/prod-before-[A-Za-z0-9._-]+$/.test(rollbackRef)) {
  throw new Error(
    "Set FLOWLEDGER_ROLLBACK_REF to the verified rollback/prod-before-* tag for the currently live release.",
  );
}

const rollbackCommit = git("rev-parse", "--verify", `refs/tags/${rollbackRef}^{commit}`);
const releaseCommit = git("rev-parse", "HEAD");
try {
  execFileSync("git", ["merge-base", "--is-ancestor", rollbackCommit, releaseCommit], {
    stdio: "ignore",
  });
} catch {
  throw new Error(
    `Rollback tag ${rollbackRef} (${rollbackCommit}) is not an ancestor of release ${releaseCommit}.`,
  );
}

const remoteTags = git(
  "ls-remote",
  "--tags",
  "origin",
  `refs/tags/${rollbackRef}`,
  `refs/tags/${rollbackRef}^{}`,
);
if (!remoteTags) {
  throw new Error(`Rollback tag ${rollbackRef} has not been pushed to origin.`);
}
const remoteEntries = new Map(
  remoteTags.split(/\r?\n/).map(line => {
    const [objectId, ref] = line.trim().split(/\s+/);
    return [ref, objectId];
  }),
);
const localTagObject = git("rev-parse", `refs/tags/${rollbackRef}`);
if (
  remoteEntries.get(`refs/tags/${rollbackRef}`) !== localTagObject
  || remoteEntries.get(`refs/tags/${rollbackRef}^{}`) !== rollbackCommit
) {
  throw new Error(
    `Remote rollback tag ${rollbackRef} does not exactly match the locally verified annotated tag and commit.`,
  );
}

const liveInspection = JSON.parse(
  vercel("inspect", "flowledger-algo.com", "--format=json"),
);
if (liveInspection.target !== "production" || liveInspection.readyState !== "READY") {
  throw new Error("The canonical production deployment is not in a ready state.");
}
const liveDeployment = JSON.parse(
  vercel("api", `/v13/deployments/${liveInspection.id}`, "--raw"),
);
const liveCommit = liveDeployment.meta?.gitCommitSha;
if (!liveCommit || rollbackCommit !== liveCommit) {
  throw new Error(
    `Rollback tag ${rollbackRef} points to ${rollbackCommit}, but live deployment ${liveInspection.id} reports ${liveCommit || "no source commit"}.`,
  );
}
const tagMessage = git(
  "for-each-ref",
  "--format=%(contents)",
  `refs/tags/${rollbackRef}`,
);
if (!tagMessage.includes(liveInspection.id)) {
  throw new Error(
    `Rollback tag ${rollbackRef} must record exact live deployment ${liveInspection.id} in its annotated message.`,
  );
}

console.log(
  `Verified production rollback: ${rollbackRef} -> ${rollbackCommit}; exact deployment ${liveInspection.id}.`,
);
console.log(`Emergency artifact rollback: vercel rollback ${liveInspection.id} --yes`);

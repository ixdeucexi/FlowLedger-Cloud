const { rmSync } = require("node:fs");
const { resolve } = require("node:path");

for (const filename of ["package-lock.json", "yarn.lock"]) {
  rmSync(resolve(__dirname, "..", filename), { force: true });
}

if (!String(process.env.npm_config_user_agent || "").startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}

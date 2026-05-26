const { spawnSync } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [path.join(__dirname, "db-smoke.cjs"), ...process.argv.slice(2)], {
  env,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

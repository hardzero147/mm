const { spawnSync } = require("node:child_process");
const path = require("node:path");

const windir = process.env.WINDIR || "C:\\Windows";
const userProfile = process.env.USERPROFILE || "";
const programFiles = process.env.ProgramFiles || "C:\\Program Files";

const env = { ...process.env };
env.PSModulePath = [
  userProfile ? path.join(userProfile, "Documents", "WindowsPowerShell", "Modules") : "",
  path.join(programFiles, "WindowsPowerShell", "Modules"),
  path.join(windir, "system32", "WindowsPowerShell", "v1.0", "Modules")
]
  .filter(Boolean)
  .join(";");

const result = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(__dirname, "sign-local-app.ps1"),
    ...process.argv.slice(2)
  ],
  {
    env,
    stdio: "inherit"
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

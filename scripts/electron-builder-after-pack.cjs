const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const KEEP_LOCALES = new Set(["en-US.pak", "th.pak"]);

module.exports = async function afterPack(context) {
  // Strip unused Electron locale files (~47MB → ~2MB)
  const localesDir = path.join(context.appOutDir, "locales");
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(file)) {
        fs.rmSync(path.join(localesDir, file));
      }
    }
  }

  // Windows-only code signing (skipped on macOS)
  if (context.electronPlatformName !== "win32" || process.platform !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appExe = path.join(context.appOutDir, `${productFilename}.exe`);
  const signer = path.join(__dirname, "run-sign-local.cjs");
  const result = spawnSync(process.execPath, [signer, appExe], { stdio: "inherit" });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Local signing failed for ${appExe}`);
};

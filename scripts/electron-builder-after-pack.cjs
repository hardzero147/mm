const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32" || process.platform !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appExe = path.join(context.appOutDir, `${productFilename}.exe`);
  const signer = path.join(__dirname, "run-sign-local.cjs");
  const result = spawnSync(process.execPath, [signer, appExe], { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Local signing failed for ${appExe}`);
  }
};

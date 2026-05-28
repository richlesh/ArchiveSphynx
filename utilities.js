const fs = require("fs");
const { execFileSync } = require("child_process");
const nodeCrypto = require("crypto");
const { LICENSE_SALT} = require("./license.js");
const { load } = require("./settings");

function expectedLicenseKey(userName) {
  const hmac = nodeCrypto.createHmac("sha256", LICENSE_SALT);
  hmac.update(userName.toLowerCase().trim());
  return hmac.digest("hex").slice(0, 16).toUpperCase();
}

function isValidLicense(key, userName) {
  if (!key || !userName) return false;
  return key.toUpperCase() === expectedLicenseKey(userName);
}

// Auto-detect tool paths
const scoopGlobal = "C:\\ProgramData\\scoop\\shims";
const scoopUser = (process.env.USERPROFILE || "") + "\\scoop\\shims";
const ZSTD_PATHS = process.platform === "win32"
    ? [scoopGlobal + "\\zstd.exe", scoopUser + "\\zstd.exe", "C:\\Program Files\\zstd\\zstd.exe", "C:\\Program Files (x86)\\zstd\\zstd.exe"]
    : ["/opt/homebrew/bin/zstd", "/usr/local/bin/zstd", "/usr/bin/zstd"];
const BZIP2_PATHS = process.platform === "win32"
    ? [scoopGlobal + "\\bzip2.exe", scoopUser + "\\bzip2.exe", "C:\\Program Files\\bzip2\\bzip2.exe", "C:\\Program Files (x86)\\GnuWin32\\bin\\bzip2.exe"]
    : ["/opt/homebrew/bin/bzip2", "/usr/local/bin/bzip2", "/usr/bin/bzip2"];
const GZIP_PATHS = process.platform === "win32"
    ? [scoopGlobal + "\\pigz.exe", scoopUser + "\\pigz.exe", scoopGlobal + "\\gzip.exe", scoopUser + "\\gzip.exe", "C:\\Program Files\\pigz\\pigz.exe", "C:\\Program Files\\GnuWin32\\bin\\gzip.exe", "C:\\Program Files\\Git\\usr\\bin\\gzip.exe"]
    : ["/opt/homebrew/bin/pigz", "/usr/local/bin/pigz", "/usr/bin/pigz", "/usr/bin/gzip", "/opt/homebrew/bin/gzip", "/usr/local/bin/gzip"];
const XZ_PATHS = process.platform === "win32"
    ? [scoopGlobal + "\\xz.exe", scoopUser + "\\xz.exe", "C:\\Program Files\\xz\\xz.exe", "C:\\Program Files\\Git\\usr\\bin\\xz.exe"]
    : ["/usr/bin/xz", "/opt/homebrew/bin/xz", "/usr/local/bin/xz"];
const SEVENZIP_PATHS = process.platform === "win32"
    ? [scoopGlobal + "\\7z.exe", scoopUser + "\\7z.exe", "C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"]
    : ["/opt/homebrew/bin/7z", "/usr/local/bin/7z", "/usr/bin/7z", "/opt/homebrew/bin/7z", "/usr/local/bin/7z"];

function findTool(settingsKey, searchPaths, name) {
  const settings = load();
  if (settings[settingsKey]) return settings[settingsKey];
  // Try bare name (on PATH)
  try { execFileSync(name, ["--version"], { timeout: 3000, stdio: "ignore" }); return name; } catch {}
  try { execFileSync(name, ["-v"], { timeout: 3000, stdio: "ignore" }); return name; } catch {}
  try { execFileSync(name, ["-help"], { timeout: 3000, stdio: "ignore" }); return name; } catch {}
  try { execFileSync(name, ["-h"], { timeout: 3000, stdio: "ignore" }); return name; } catch {}
  // Search common locations
  for (const p of searchPaths) { if (fs.existsSync(p)) return p; }
  return null;
}

function getZstdPath() { return findTool("zstd-path", ZSTD_PATHS, "zstd"); }
function getBzip2Path() { return findTool("bzip2-path", BZIP2_PATHS, "bzip2"); }
function getGzipPath() { return findTool("gzip-path", GZIP_PATHS, "pigz") ||
    findTool("gzip-path", GZIP_PATHS, "gzip"); }
function getXzPath() { return findTool("xz-path", XZ_PATHS, "xz"); }
function get7zPath() { return findTool("7z-path", SEVENZIP_PATHS, "7z"); }

module.exports = { expectedLicenseKey, isValidLicense, getZstdPath, getBzip2Path, getGzipPath, getXzPath, get7zPath };

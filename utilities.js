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
const FFPROBE_SEARCH = process.platform === "win32"
    ? [scoopGlobal + "\\ffprobe.exe", scoopUser + "\\ffprobe.exe", "C:\\Program Files\\FFmpeg\\bin\\ffprobe.exe", "C:\\Program Files (x86)\\FFmpeg\\bin\\ffprobe.exe"]
    : ["/usr/local/bin/ffprobe", "/opt/homebrew/bin/ffprobe", "/usr/bin/ffprobe"];
const EXIFTOOL_SEARCH = process.platform === "win32"
    ? [scoopGlobal + "\\exiftool.exe", scoopUser + "\\exiftool.exe", "C:\\Program Files\\ExifTool\\exiftool.exe", "C:\\Windows\\exiftool.exe"]
    : ["/usr/local/bin/exiftool", "/opt/homebrew/bin/exiftool", "/usr/bin/exiftool"];

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

function getFFprobePath() { return findTool("ffprobePath", FFPROBE_SEARCH, "ffprobe"); }
function getExiftoolPath() { return findTool("exiftoolPath", EXIFTOOL_SEARCH, "exiftool"); }

module.exports = { expectedLicenseKey, isValidLicense, getFFprobePath, getExiftoolPath };

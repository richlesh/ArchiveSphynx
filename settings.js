const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".archivesphinx-settings.json");

const DEFAULTS = {
  columnOrder: ["name", "modified", "size", "compressed", "attributes", "type", "method"],
  columnWidths: {},
  selectionColor: "#0000FF",
  buttonColor: "#0000FF",
  windowBounds: { width: 1000, height: 700 },
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

module.exports = { load, save };

const fs = require("fs");
const path = require("path");
const os = require("os");

const SETTINGS_PATH = path.join(os.homedir(), ".archivesphinx-settings.json");

let originalContent = null;

beforeAll(() => {
  try { originalContent = fs.readFileSync(SETTINGS_PATH, "utf8"); } catch {}
});

afterAll(() => {
  if (originalContent !== null) {
    fs.writeFileSync(SETTINGS_PATH, originalContent, "utf8");
  }
});

const { load, save } = require("../settings");

describe("settings", () => {
  test("load returns object with expected default keys", () => {
    const s = load();
    expect(s).toHaveProperty("columnOrder");
    expect(s).toHaveProperty("selectionColor");
    expect(s).toHaveProperty("windowBounds");
  });

  test("save and load round-trips data", () => {
    const before = load();
    const testVal = "test-" + Date.now();
    save({ ...before, _testField: testVal });
    const after = load();
    expect(after._testField).toBe(testVal);
    // Clean up
    delete before._testField;
    save(before);
  });

  test("load merges defaults with saved data", () => {
    const s = load();
    // Should always have defaults even if file has extra fields
    expect(Array.isArray(s.columnOrder)).toBe(true);
    expect(typeof s.selectionColor).toBe("string");
    expect(typeof s.windowBounds).toBe("object");
  });
});

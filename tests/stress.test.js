// Run with
// ARCHIVE_MODE=cli npx jest tests/stress.test.js
// ARCHIVE_MODE=fallback npx jest tests/stress.test.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

jest.mock("electron", () => ({
  ipcRenderer: { invoke: jest.fn() },
}), { virtual: true });

const { createArchive, setGzipPath, setBzip2Path, setXzPath, setZstdPath, setSevenZipPath } = require("../archive");

// ARCHIVE_MODE=cli  → use CLI tools (pigz/gzip, bzip2, xz, zstd, 7z)
// ARCHIVE_MODE=fallback → force JS fallbacks by setting invalid paths
const mode = process.env.ARCHIVE_MODE || "auto";
if (mode === "cli") {
  process.stdout.write("Using CLI tools for compression\n");
  setGzipPath("gzip");
  setBzip2Path("bzip2");
  setXzPath("xz");
  setZstdPath("zstd");
  setSevenZipPath("7z");
} else if (mode === "fallback") {
  process.stdout.write("Using JS fallbacks tools for compression\n");
  setGzipPath("__invalid_gzip__");
  setBzip2Path("__invalid_bzip2__");
  setXzPath("__invalid_xz__");
  setZstdPath("__invalid_zstd__");
  // 7z has no JS fallback, keep it valid
  setSevenZipPath("7z");
} else {
  process.stdout.write("Using JS fallbacks for compression\n");
}

const dataDir = path.join(__dirname, "data");
const refDir = path.join(dataDir, "stress_test");
const outDir = path.join(os.tmpdir(), "archivesphynx-stress-test-" + Date.now());

const formats = [
  { ext: "txz", file: "stress_test.txz" },
  { ext: "7z", file: "stress_test.7z" },
  { ext: "zip", file: "stress_test.zip" },
  { ext: "tar", file: "stress_test.tar" },
  { ext: "tgz", file: "stress_test.tgz" },
  { ext: "tbz2", file: "stress_test.tbz2" },
  { ext: "tzst", file: "stress_test.tzst" },
  { ext: "t7z", file: "stress_test.t7z" },
];

// Build reference file map: relative path -> md5 hash
function buildRefMap(dir) {
  const map = new Map();
  function walk(d, rel) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const relPath = rel ? rel + "/" + name : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, relPath);
      } else {
        const hash = crypto.createHash("md5").update(fs.readFileSync(full)).digest("hex");
        map.set(relPath, hash);
      }
    }
  }
  walk(dir, "");
  // Ignore macOS metadata files
  for (const key of map.keys()) {
    if (path.basename(key) === ".DS_Store") map.delete(key);
  }
  return map;
}

// Compare extracted directory against reference
function verifyExtracted(extractDir, refMap) {
  const errors = [];
  for (const [relPath, expectedHash] of refMap) {
    const fullPath = path.join(extractDir, relPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing: ${relPath}`);
      continue;
    }
    const actualHash = crypto.createHash("md5").update(fs.readFileSync(fullPath)).digest("hex");
    if (actualHash !== expectedHash) {
      errors.push(`Hash mismatch: ${relPath}`);
    }
  }
  return errors;
}

let refMap;

beforeAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  refMap = buildRefMap(refDir);
});

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

// Filter to available source files
const available = formats.filter((f) => fs.existsSync(path.join(dataDir, f.file)));

describe.each(available)("Stress: $ext", ({ ext, file }) => {
  test.each(formats)("→ $ext", async ({ ext: targetExt }) => {
    const srcPath = path.join(dataDir, file);
    const srcArchive = createArchive(srcPath);
    await srcArchive.open(srcPath);
    const srcEntries = srcArchive.getEntries();

    // Convert to target format
    const outPath = path.join(outDir, `stress-${ext}-to-${targetExt}.${targetExt}`);
    const destArchive = createArchive(outPath);
    const startTime = Date.now();
    destArchive.create();

    for (const entry of srcEntries) {
      if (entry.isDirectory) {
        destArchive.addFile(entry.entryName, Buffer.alloc(0));
      } else {
        const data = srcArchive.getData(entry.entryName);
        if (data) destArchive.addFile(entry.entryName, data);
      }
    }

    await destArchive.save(outPath);
    expect(fs.existsSync(outPath)).toBe(true);

    // Extract and verify
    const extractDir = path.join(outDir, `extract-${ext}-to-${targetExt}`);
    fs.mkdirSync(extractDir, { recursive: true });

    const verifyArchive = createArchive(outPath);
    await verifyArchive.open(outPath);
    await verifyArchive.extractAll(extractDir);

    const errors = verifyExtracted(extractDir, refMap);
    process.stdout.write(`Converting ${ext} → ${targetExt}... ${Date.now() - startTime}ms\n`);
    expect(errors).toEqual([]);
  }, 300000);
});

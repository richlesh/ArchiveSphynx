const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const dataDir = path.join(__dirname, "data");
const refDir = path.join(dataDir, "stress_test");

const formats = [
  { ext: "zip", file: "stress_test.zip" },
  { ext: "tar", file: "stress_test.tar" },
  { ext: "tgz", file: "stress_test.tgz" },
  { ext: "tbz", file: "stress_test.tbz" },
  { ext: "txz", file: "stress_test.txz" },
  { ext: "tzst", file: "stress_test.tzst" },
  { ext: "7z", file: "stress_test.7z" },
];

function buildRefMap() {
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
  walk(refDir, "");
  for (const key of map.keys()) {
    if (path.basename(key) === ".DS_Store") map.delete(key);
  }
  return map;
}

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

function runStressTest(sourceExt) {
  const { createArchive, setGzipPath, setBzip2Path, setXzPath, setZstdPath, setSevenZipPath } = require("../archive");

  const mode = process.env.ARCHIVE_MODE || "auto";
  if (mode === "cli") {
    setGzipPath("gzip"); setBzip2Path("bzip2"); setXzPath("xz"); setZstdPath("zstd"); setSevenZipPath("/opt/homebrew/bin/7z");
  } else if (mode === "fallback") {
    setGzipPath("__invalid__"); setBzip2Path("__invalid__"); setXzPath("__invalid__"); setZstdPath("__invalid__"); setSevenZipPath("/opt/homebrew/bin/7z");
  }

  const source = formats.find((f) => f.ext === sourceExt);
  const srcPath = path.join(dataDir, source.file);
  const outDir = path.join(os.tmpdir(), `archivesphynx-stress-${sourceExt}-${Date.now()}`);

  let refMap;

  beforeAll(() => {
    fs.mkdirSync(outDir, { recursive: true });
    refMap = buildRefMap();
  });

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test.each(formats)(`${sourceExt} → $ext`, async ({ ext: targetExt }) => {
    const srcArchive = createArchive(srcPath);
    await srcArchive.open(srcPath);
    const srcEntries = srcArchive.getEntries();

    const outPath = path.join(outDir, `stress-${sourceExt}-to-${targetExt}.${targetExt}`);
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

    const extractDir = path.join(outDir, `extract-${targetExt}`);
    fs.mkdirSync(extractDir, { recursive: true });

    const verifyArchive = createArchive(outPath);
    await verifyArchive.open(outPath);
    await verifyArchive.extractAll(extractDir);

    const errors = verifyExtracted(extractDir, refMap);
    process.stdout.write(`${sourceExt} → ${targetExt}... ${Date.now() - startTime}ms\n`);
    expect(errors).toEqual([]);
  }, 300000);
}

module.exports = { runStressTest };

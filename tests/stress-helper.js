const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const dataDir = path.join(__dirname, "data");

const baseNames = {
  small: "stress_test",
  medium: "stress_test_2g",
  large: "stress_test_9g",
};

const extensions = ["zip", "tar", "7z",
  ...(process.env.EXHAUSTIVE === "true" ? ["tgz", "tbz", "txz", "tzst"] : []),
];

function getFormats(size) {
  const base = baseNames[size] || baseNames.small;
  return extensions.map((ext) => ({ ext, file: `${base}.${ext}` }));
}

function getRefDir(size) {
  const base = baseNames[size] || baseNames.small;
  return path.join(dataDir, base);
}

function buildRefMap(refDir) {
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

function runStressTest(sourceExt, size = "small") {
  const { createArchive, setGzipPath, setBzip2Path, setXzPath, setZstdPath, setSevenZipPath } = require("../archive");

  const mode = process.env.ARCHIVE_MODE || "auto";
  if (mode === "cli") {
    setGzipPath("gzip"); setBzip2Path("bzip2"); setXzPath("xz"); setZstdPath("zstd"); setSevenZipPath("7z");
  } else if (mode === "fallback") {
    setGzipPath("__invalid__"); setBzip2Path("__invalid__"); setXzPath("__invalid__"); setZstdPath("__invalid__"); setSevenZipPath("__invalid__");
  }

  const formats = getFormats(size);
  const source = formats.find((f) => f.ext === sourceExt);
  if (!source) { test("skipped (not in extensions)", () => {}); return; }
  const srcPath = path.join(dataDir, source.file);
  const refDir = getRefDir(size);
  const outDir = path.join(os.tmpdir(), `archivesphynx-stress-${size}-${sourceExt}-${Date.now()}`);

  let refMap;

  beforeAll(() => {
    fs.mkdirSync(outDir, { recursive: true });
    refMap = buildRefMap(refDir);
  });

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test.each(formats)(`${sourceExt} → $ext`, async ({ ext: targetExt }) => {
    const { StreamingReader, StreamingWriter, ArchiveReader, ArchiveWriter, FORMAT, FILTER } = require("sphynx");

    const formatMap = { zip: "ZIP", tar: "TAR", "7z": "SEVENZIP" };
    const filterMap = { tgz: "GZIP", tbz: "BZIP2", txz: "XZ", tzst: "ZSTD" };
    const dstFormat = formatMap[targetExt] || "TAR";
    const dstFilter = filterMap[targetExt] || "NONE";

    const outPath = path.join(outDir, `stress-${sourceExt}-to-${targetExt}.${targetExt}`);
    const startTime = Date.now();

    if (size === "small") {
      // In-memory approach for small archives
      const srcBuf = fs.readFileSync(srcPath);
      const reader = await ArchiveReader.open(srcBuf);
      const writer = await ArchiveWriter.create(FORMAT[dstFormat], FILTER[dstFilter]);

      for (const entry of reader) {
        if (entry.isDirectory) {
          writer.addDirectory(entry.pathname, { mtime: entry.mtime, perm: entry.perm });
        } else {
          const data = reader.readAll();
          writer.addFile(entry.pathname, data, { mtime: entry.mtime, perm: entry.perm });
        }
      }
      reader.close();
      fs.writeFileSync(outPath, writer.finish());
    } else {
      // Streaming approach for medium/large archives
      const reader = sourceExt === "7z"
        ? await StreamingReader.openFileSeekable(srcPath)
        : await StreamingReader.openFile(srcPath);
      const writer = await StreamingWriter.createFile(outPath, dstFormat, dstFilter);

      for (const entry of reader) {
        if (entry.isDirectory) {
          writer.addDirectory(entry.pathname, { mtime: entry.mtime, perm: entry.perm });
        } else {
          const data = reader.readAll();
          writer.addFile(entry.pathname, data, { mtime: entry.mtime, perm: entry.perm });
        }
      }
      reader.close();
      writer.finish();
    }

    expect(fs.existsSync(outPath)).toBe(true);

    const extractDir = path.join(outDir, `extract-${targetExt}`);
    fs.mkdirSync(extractDir, { recursive: true });

    const verifyArchive = createArchive(outPath);
    await verifyArchive.open(outPath);
    await verifyArchive.extractAll(extractDir);

    const errors = verifyExtracted(extractDir, refMap);
    process.stdout.write(`${sourceExt} → ${targetExt}... ${Date.now() - startTime}ms\n`);
    expect(errors).toEqual([]);
  }, 10 * 60 * 1000);
}

module.exports = { runStressTest };

const fs = require("fs");
const path = require("path");
const os = require("os");

jest.mock("electron", () => ({
  ipcRenderer: { invoke: jest.fn() },
}), { virtual: true });

const { createArchive } = require("../archive");

const dataDir = path.join(__dirname, "data");
const outDir = path.join(os.tmpdir(), "archivesphynx-convert-test-" + Date.now());

// Readable source formats (files in tests/data/)
const readableFormats = [
  { ext: "zip", file: "test.zip" },
  { ext: "tar", file: "test.tar" },
  { ext: "tgz", file: "test.tgz" },
  { ext: "tbz2", file: "test.tbz2" },
  { ext: "txz", file: "test.txz" },
  { ext: "tzst", file: "test.tzst" },
  { ext: "t7z", file: "test.t7z" },
  { ext: "7z", file: "test.7z" },
  // RAR omitted — cannot create test file without proprietary tool
];

// Writable target formats
const writableFormats = [
  { ext: "zip", name: "ZIP" },
  { ext: "tar", name: "TAR" },
  { ext: "tgz", name: "TGZ" },
  { ext: "tbz2", name: "TBZ2" },
  { ext: "txz", name: "TXZ" },
  { ext: "tzst", name: "TZST" },
  { ext: "t7z", name: "T7Z" },
  { ext: "7z", name: "7Z" },
];

beforeAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

// Filter to only formats whose test files exist
const availableReadable = readableFormats.filter((f) =>
  fs.existsSync(path.join(dataDir, f.file))
);

describe.each(availableReadable)("Read $ext", ({ ext, file }) => {
  let srcArchive;
  let srcEntries;

  beforeAll(async () => {
    const srcPath = path.join(dataDir, file);
    srcArchive = createArchive(srcPath);
    await srcArchive.open(srcPath);
    srcEntries = srcArchive.getEntries();
  });

  test("opens successfully with entries", () => {
    expect(srcEntries.length).toBeGreaterThan(0);
    const files = srcEntries.filter((e) => !e.isDirectory);
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(writableFormats)("converts to $name", async ({ ext: targetExt }) => {
    const outPath = path.join(outDir, `${ext}-to-${targetExt}.${targetExt}`);
    const destArchive = createArchive(outPath);
    destArchive.create();

    // Copy entries from source to destination
    for (const entry of srcEntries) {
      if (entry.isDirectory) {
        destArchive.addFile(entry.entryName, Buffer.alloc(0));
      } else {
        const data = srcArchive.getData(entry.entryName);
        if (data) destArchive.addFile(entry.entryName, data);
      }
    }

    // Save
    await destArchive.save(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(0);

    // Re-open and verify entry count matches
    const verifyArchive = createArchive(outPath);
    await verifyArchive.open(outPath);
    const verifyEntries = verifyArchive.getEntries();
    const srcFiles = srcEntries.filter((e) => !e.isDirectory);
    const destFiles = verifyEntries.filter((e) => !e.isDirectory);
    expect(destFiles.length).toBe(srcFiles.length);
  });
});

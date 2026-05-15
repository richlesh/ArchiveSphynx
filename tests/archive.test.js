const fs = require("fs");
const path = require("path");
const os = require("os");

// Mock electron's ipcRenderer for TAR save
jest.mock("electron", () => ({
  ipcRenderer: { invoke: jest.fn() },
}), { virtual: true });

const { ZipArchive, TarArchive } = require("../archive");

const tmpDir = path.join(os.tmpdir(), "archivesphynx-test-" + Date.now());

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ZipArchive", () => {
  test("create initializes empty archive", () => {
    const zip = new ZipArchive();
    zip.create();
    expect(zip.getEntries()).toEqual([]);
  });

  test("addFile adds a file entry", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("hello.txt", Buffer.from("hello world"));
    const entries = zip.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].entryName).toBe("hello.txt");
    expect(entries[0].isDirectory).toBe(false);
    expect(entries[0].size).toBe(11);
  });

  test("addFile adds a directory entry", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("folder/", Buffer.alloc(0));
    const entries = zip.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].entryName).toBe("folder/");
    expect(entries[0].isDirectory).toBe(true);
  });

  test("deleteFile removes an entry", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("a.txt", Buffer.from("a"));
    zip.addFile("b.txt", Buffer.from("b"));
    zip.deleteFile("a.txt");
    const entries = zip.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].entryName).toBe("b.txt");
  });

  test("renameEntry renames a file", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("old.txt", Buffer.from("data"));
    zip.renameEntry("old.txt", "new.txt");
    expect(zip.getEntry("new.txt")).not.toBeNull();
    expect(zip.getEntry("old.txt")).toBeNull();
  });

  test("renameEntry renames a folder and its children", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("dir/", Buffer.alloc(0));
    zip.addFile("dir/file.txt", Buffer.from("data"));
    zip.renameEntry("dir/", "renamed/");
    expect(zip.getEntry("renamed/")).not.toBeNull();
    expect(zip.getEntry("renamed/file.txt")).not.toBeNull();
    expect(zip.getEntry("dir/")).toBeNull();
  });

  test("getData returns buffer for added file", () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("test.txt", Buffer.from("content"));
    const data = zip.getData("test.txt");
    expect(data.toString()).toBe("content");
  });

  test("save and open round-trips entries", async () => {
    const zip = new ZipArchive();
    zip.create();
    zip.addFile("folder/", Buffer.alloc(0));
    zip.addFile("folder/hello.txt", Buffer.from("hello"));
    zip.addFile("root.txt", Buffer.from("root"));

    const filePath = path.join(tmpDir, "test.zip");
    await zip.save(filePath);

    const zip2 = new ZipArchive();
    await zip2.open(filePath);
    const entries = zip2.getEntries();
    expect(entries.length).toBe(3);
    expect(entries.find((e) => e.entryName === "folder/hello.txt").size).toBe(5);
  });
});

describe("TarArchive", () => {
  test("create initializes empty archive", () => {
    const tar = new TarArchive("none");
    tar.create();
    expect(tar.getEntries()).toEqual([]);
  });

  test("addFile adds a file entry", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("hello.txt", Buffer.from("hello world"));
    const entries = tar.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].entryName).toBe("hello.txt");
    expect(entries[0].isDirectory).toBe(false);
    expect(entries[0].size).toBe(11);
  });

  test("addFile adds a directory entry", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("folder/", Buffer.alloc(0));
    const entries = tar.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].isDirectory).toBe(true);
  });

  test("deleteFile removes an entry", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("a.txt", Buffer.from("a"));
    tar.addFile("b.txt", Buffer.from("b"));
    tar.deleteFile("a.txt");
    const entries = tar.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].entryName).toBe("b.txt");
  });

  test("renameEntry renames a file", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("old.txt", Buffer.from("data"));
    tar.renameEntry("old.txt", "new.txt");
    expect(tar.getEntry("new.txt")).not.toBeNull();
    expect(tar.getEntry("old.txt")).toBeNull();
  });

  test("renameEntry renames a folder and its children", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("dir/", Buffer.alloc(0));
    tar.addFile("dir/file.txt", Buffer.from("data"));
    tar.renameEntry("dir/", "renamed/");
    expect(tar.getEntry("renamed/")).not.toBeNull();
    expect(tar.getEntry("renamed/file.txt")).not.toBeNull();
    expect(tar.getEntry("dir/")).toBeNull();
  });

  test("getData returns buffer for added file", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("test.txt", Buffer.from("content"));
    const data = tar.getData("test.txt");
    expect(data.toString()).toBe("content");
  });

  test("getData returns empty buffer for zero-size file", () => {
    const tar = new TarArchive("none");
    tar.create();
    tar.addFile("empty.txt", Buffer.alloc(0));
    const data = tar.getData("empty.txt");
    expect(data).toEqual(Buffer.alloc(0));
  });
});

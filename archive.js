const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { StreamingReader, StreamingWriter, ArchiveReader, ArchiveWriter, FORMAT, FILTER, zstdCompress, zstdCompressFile } = require("sphynx");
const { execFileSync } = require("child_process");

const isMac = process.platform === "darwin";

// On macOS, remap __MACOSX/path/._file to path/._file so resource forks merge
function remapExtractPath(entryName) {
  if (!isMac) return entryName;
  if (!entryName.startsWith("__MACOSX/")) return entryName;
  return entryName.slice("__MACOSX/".length);
}

// On macOS, merge ._ files into resource forks via dot_clean
function mergeResourceForks(dest) {
  if (!isMac) return;
  try {
    const { spawnSync } = require("child_process");
    spawnSync("dot_clean", [dest], { stdio: "ignore" });
  } catch {}
}

// XZ/LZMA decompression via sphynx (libarchive WASM)
async function xzDecompress(buf) {
  const reader = await ArchiveReader.open(buf);
  const entry = reader.next();
  const result = entry ? reader.readAll() : Buffer.alloc(0);
  reader.close();
  return result;
}

async function xzCompress(buf) {
  const writer = await ArchiveWriter.create(FORMAT.RAW, FILTER.XZ);
  writer.addFile("data", buf);
  return writer.finish();
}

// Generic decompression via sphynx (handles bzip2, zstd, xz, gzip)
// Decompresses a compressed tar to a file, streaming entry-by-entry
// If outPath is provided, writes directly to file and returns null
// If outPath is not provided, returns a Buffer (for small archives only)
async function sphynxDecompressToTar(compressedBuf, onProgress, outPath) {
  if (outPath) {
    // Stream file-to-file: no full-file memory load needed
    const srcPath = typeof compressedBuf === "string" ? compressedBuf : null;
    let reader;
    if (srcPath) {
      reader = await StreamingReader.openFile(srcPath);
    } else {
      reader = await ArchiveReader.open(compressedBuf);
    }
    const writer = await StreamingWriter.createFile(outPath, "TAR", "NONE");
    let entry;
    let count = 0;
    while ((entry = reader.next()) !== null) {
      if (entry.isDirectory) {
        writer.addDirectory(entry.pathname, { mtime: entry.mtime, perm: entry.perm });
      } else {
        const data = reader.readAll();
        writer.addFile(entry.pathname, data, { mtime: entry.mtime, perm: entry.perm });
      }
      count++;
      if (onProgress && count % 50 === 0) {
        onProgress(count, 0);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    reader.close();
    writer.finish();
    return null;
  }
  // In-memory fallback for small archives
  const reader = await ArchiveReader.open(compressedBuf);
  const writer = await ArchiveWriter.create(FORMAT.TAR, FILTER.NONE);
  let entry;
  let count = 0;
  while ((entry = reader.next()) !== null) {
    if (entry.isDirectory) {
      writer.addDirectory(entry.pathname, { mtime: entry.mtime, perm: entry.perm });
    } else {
      const data = reader.readAll();
      writer.addFile(entry.pathname, data, { mtime: entry.mtime, perm: entry.perm });
    }
    count++;
    if (onProgress && count % 50 === 0) {
      onProgress(count, 0);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  reader.close();
  return writer.finish();
}

// Decompress raw compressed data (not an archive, just a compressed blob)
async function sphynxDecompressRaw(buf) {
  // For bzip2/zstd/xz compressed tar files, libarchive treats them as
  // filter+format, so we extract all entries and re-pack as raw tar
  return sphynxDecompressToTar(buf);
}

let zstdPath = "zstd";
function getZstdPath() { return zstdPath; }
function setZstdPath(p) { if (p) zstdPath = p; }

function isZstdAvailable() {
  return true;
}

let bzip2Path = "bzip2";
function getBzip2Path() { return bzip2Path; }
function setBzip2Path(p) { if (p) bzip2Path = p; }

let gzipPath = "gzip";
function getGzipPath() { return gzipPath; }
function setGzipPath(p) { if (p) gzipPath = p; }

let xzPath = "xz";
function getXzPath() { return xzPath; }
function setXzPath(p) { if (p) xzPath = p; }

let sevenZipPath = "7z";
function getSevenZipPath() { return sevenZipPath; }
function setSevenZipPath(p) { if (p) sevenZipPath = p; }

let bzip2FallbackUsed = false;
function wasBzip2FallbackUsed() { const v = bzip2FallbackUsed; bzip2FallbackUsed = false; return v; }

// Unified entry format: { entryName, isDirectory, size, compressedSize, time, method, data }

function detectFormat(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".jar")) return "jar";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz")) return "tar.bz2";
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return "tar.xz";
  if (lower.endsWith(".tar.zst") || lower.endsWith(".tar.zstd") || lower.endsWith(".tzst") || lower.endsWith(".tzs")) return "tar.zst";
  if (lower.endsWith(".tar")) return "tar";
  if (lower.endsWith(".7z")) return "7z";
  if (lower.endsWith(".rar")) return "rar";
  if (lower.endsWith(".deb")) return "deb";
  if (lower.endsWith(".rpm")) return "rpm";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".iso")) return "iso";
  return null;
}

// ─── ZIP Backend ───

class ZipArchive {
  constructor() {
    this.format = "zip";
    this.entries = [];
    this._sourceFile = null;
  }

  create() {
    this.entries = [];
    this._sourceFile = null;
  }

  async open(filePath, onProgress) {
    this._sourceFile = filePath;
    this.entries = [];
    const reader = await StreamingReader.openFile(filePath);
    let count = 0;
    for (const entry of reader) {
      let size = entry.size;
      if (!entry.isDirectory && size === 0) {
        // ZIP entries may not report size in header; measure from data
        const data = reader.readAll();
        size = data.length;
      }
      this.entries.push({
        entryName: entry.pathname,
        isDirectory: entry.isDirectory,
        size,
        compressedSize: 0,
        time: entry.mtime ? new Date(entry.mtime * 1000) : null,
        method: "Deflate",
        attr: entry.perm << 16,
        _data: null,
      });
      count++;
      if (onProgress && count % 50 === 0) {
        onProgress(count, 0);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    reader.close();
    if (onProgress) onProgress(count, count);
  }

  async save(filePath) {
    const writer = await StreamingWriter.createFile(filePath, "ZIP", "NONE");
    for (const e of this.entries) {
      if (e.isDirectory) {
        writer.addDirectory(e.entryName, { mtime: e.time ? Math.floor(e.time.getTime() / 1000) : undefined, perm: e.attr ? (e.attr >>> 16) : 0o755 });
      } else {
        const data = e._data || await this._readEntryData(e);
        writer.addFile(e.entryName, data, { mtime: e.time ? Math.floor(e.time.getTime() / 1000) : undefined, perm: e.attr ? (e.attr >>> 16) : 0o644 });
      }
    }
    writer.finish();
    await this.open(filePath);
  }

  async _readEntryData(entry) {
    if (entry._data) return entry._data;
    if (!this._sourceFile) return Buffer.alloc(0);
    const reader = await StreamingReader.openFile(this._sourceFile);
    let result = Buffer.alloc(0);
    for (const e of reader) {
      if (e.pathname === entry.entryName && !e.isDirectory) {
        result = reader.readAll();
        break;
      }
    }
    reader.close();
    return result;
  }

  refresh() {}

  getEntries() {
    return this.entries.map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.size || 0,
      compressedSize: e.compressedSize || 0,
      time: e.time,
      method: e.method || "",
      attr: e.attr || 0,
    }));
  }

  addFile(entryName, data) {
    this.entries.push({
      entryName,
      isDirectory: entryName.endsWith("/"),
      size: data.length,
      compressedSize: 0,
      time: new Date(),
      method: "Deflate",
      attr: 0,
      _data: entryName.endsWith("/") ? null : data,
    });
  }

  deleteFile(entryName) {
    this.entries = this.entries.filter((e) => e.entryName !== entryName);
  }

  renameEntry(oldPath, newPath) {
    if (oldPath.endsWith("/")) {
      this.entries.filter((e) => e.entryName.startsWith(oldPath))
        .forEach((e) => { e.entryName = newPath + e.entryName.slice(oldPath.length); });
    } else {
      const entry = this.entries.find((e) => e.entryName === oldPath);
      if (entry) entry.entryName = newPath;
    }
  }

  getEntry(entryName) {
    return this.entries.find((e) => e.entryName === entryName) || null;
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (entry._data) return entry._data;
    if (!this._sourceFile) return null;
    const { _getModuleSync } = require("sphynx");
    const mod = _getModuleSync();
    if (!mod) return this._getDataSync(entryName);
    const ptr = mod._reader_new();
    const r = mod.ccall("reader_open_filename", "number", ["number", "string"], [ptr, this._sourceFile]);
    if (r !== 0) { mod._reader_close(ptr); return this._getDataSync(entryName); }
    let result = null;
    while (mod._reader_next(ptr) === 0) {
      const name = mod.UTF8ToString(mod._entry_pathname());
      if (name === entryName) {
        const chunks = [];
        const readBuf = mod._malloc(262144);
        let n;
        while ((n = mod._reader_read_data(ptr, readBuf, 262144)) > 0) {
          chunks.push(Buffer.from(mod.HEAPU8.slice(readBuf, readBuf + n)));
        }
        mod._free(readBuf);
        result = Buffer.concat(chunks);
        break;
      }
    }
    mod._reader_close(ptr);
    return result;
  }

  _getDataSync(entryName) {
    if (!this._sourceFile) return null;
    // Use 7z CLI as sync fallback for getData
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["e", "-so", "-y", this._sourceFile, entryName], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    if (result.status === 0 && result.stdout && result.stdout.length > 0) return result.stdout;
    return null;
  }

  extractEntry(entryName, dest) {
    if (!this._sourceFile) return;
    const { spawnSync } = require("child_process");
    spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._sourceFile, entryName], { stdio: ["ignore", "pipe", "pipe"] });
  }

  async extractAll(dest, onProgress) {
    if (!this._sourceFile) return;
    const reader = await StreamingReader.openFile(this._sourceFile);
    let count = 0;
    const total = this.entries.length;
    const dirs = [];
    for (const entry of reader) {
      count++;
      if (onProgress && count % 100 === 0) onProgress(count, total);
      const mapped = remapExtractPath(entry.pathname);
      if (!mapped) continue;
      const outPath = path.join(dest, mapped);
      if (entry.isDirectory) {
        fs.mkdirSync(outPath, { recursive: true });
        if (entry.mtime) dirs.push({ path: outPath, mtime: new Date(entry.mtime * 1000) });
      } else {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const data = reader.readAll();
        fs.writeFileSync(outPath, data);
        if (entry.mtime) {
          try { fs.utimesSync(outPath, new Date(entry.mtime * 1000), new Date(entry.mtime * 1000)); } catch {}
        }
      }
    }
    reader.close();
    mergeResourceForks(dest);
    // Set directory timestamps (explicit dirs + inferred from file mtimes)
    const dirTimes = new Map();
    for (const d of dirs) {
      dirTimes.set(d.path, d.mtime);
    }
    // Infer timestamps for implicit directories from their children
    for (const e of this.entries) {
      if (e.isDirectory || !e.time) continue;
      const mapped = remapExtractPath(e.entryName);
      if (!mapped) continue;
      let parent = path.dirname(path.join(dest, mapped));
      while (parent.length > dest.length) {
        const existing = dirTimes.get(parent);
        const t = e.time instanceof Date ? e.time : new Date(e.time * 1000);
        if (!existing || t > existing) dirTimes.set(parent, t);
        parent = path.dirname(parent);
      }
    }
    // Apply deepest first so parent timestamps aren't overwritten
    const sortedDirs = [...dirTimes.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [p, t] of sortedDirs) {
      try { fs.utimesSync(p, t, t); } catch {}
    }
    if (onProgress) onProgress(total, total);
  }

  async testIntegrity() {
    const errors = [];
    if (!this._sourceFile) return errors;
    try {
      const reader = await StreamingReader.openFile(this._sourceFile);
      for (const entry of reader) {
        if (!entry.isDirectory) {
          try { reader.readAll(); }
          catch (e) { errors.push(entry.pathname + ": " + e.message); }
        }
      }
      reader.close();
    } catch (e) {
      errors.push("Archive: " + e.message);
    }
    return errors;
  }
}

// ─── TAR Backend ───

class TarArchive {
  constructor(compression) {
    this.compression = compression || "none";
    this.entries = []; // { entryName, isDirectory, size, time, mode, data?, sourceFile?, offset? }
    this.format = "tar";
    this._sourceFile = null; // decompressed tar file path (temp or original)
    this._tempFile = null;
  }

  get formatLabel() {
    return "tar" + (this.compression !== "none" ? "." + this.compression : "");
  }

  create() {
    this.entries = [];
    this._sourceFile = null;
  }

  async open(filePath, onProgress) {
    this.entries = [];
    if (this.compression === "none") {
      this._sourceFile = filePath;
    } else {
      // Decompress to a temp file
      const os = require("os");
      this._tempFile = path.join(os.tmpdir(), "archivesphynx-" + Date.now() + ".tar");
      if (this.compression === "gz") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(getGzipPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          await sphynxDecompressToTar(filePath, onProgress, this._tempFile);
          onProgress = null;
        }
      } else if (this.compression === "bz2") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve, reject) => {
          const proc = spawn(getBzip2Path(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          await sphynxDecompressToTar(filePath, onProgress, this._tempFile);
          onProgress = null;
        }
      } else if (this.compression === "xz") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(getXzPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          await sphynxDecompressToTar(filePath, onProgress, this._tempFile);
          onProgress = null;
        }
      } else if (this.compression === "zst") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(getZstdPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          await sphynxDecompressToTar(filePath, onProgress, this._tempFile);
          onProgress = null;
        }
      }
      this._sourceFile = this._tempFile;
    }
    return this._parseOffsets(onProgress);
  }

  _decompress(buf) {
    switch (this.compression) {
      case "gz": return zlib.gunzipSync(buf);
      case "bz2":
        return execFileSync(getBzip2Path(), ["-d", "-c"], { input: buf, maxBuffer: Infinity });
      default: return buf;
    }
  }

  _compress(buf) {
    switch (this.compression) {
      case "gz": return zlib.gzipSync(buf);
      case "bz2":
        return execFileSync(getBzip2Path(), ["-c"], { input: buf, maxBuffer: Infinity });
      default: return buf;
    }
  }

  async _parseOffsets(onProgress) {
    const sourceFile = this._sourceFile;
    const fd = fs.openSync(sourceFile, "r");
    const hdrBuf = Buffer.alloc(512);
    let filePos = 0;
    let count = 0;
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;
    let longName = null;
    let longLink = null;
    let paxAttrs = null;

    while (filePos + 512 <= fileSize) {
      const bytesRead = fs.readSync(fd, hdrBuf, 0, 512, filePos);
      if (bytesRead < 512) break;

      // Check for end-of-archive (two zero blocks)
      let allZero = true;
      for (let j = 0; j < 512; j++) { if (hdrBuf[j] !== 0) { allZero = false; break; } }
      if (allZero) break;

      const type = String.fromCharCode(hdrBuf[156]);
      const hdrSize = parseInt(hdrBuf.toString("utf8", 124, 136).trim(), 8) || 0;
      const paddedSize = Math.ceil(hdrSize / 512) * 512;
      filePos += 512;

      // GNU long name/link extension headers
      if (type === "L") {
        if (hdrSize > 0) {
          const nameBuf = Buffer.alloc(hdrSize);
          fs.readSync(fd, nameBuf, 0, hdrSize, filePos);
          longName = nameBuf.toString("utf8").replace(/\0+$/, "");
        }
        filePos += paddedSize;
        continue;
      }
      if (type === "K") {
        if (hdrSize > 0) {
          const linkBuf = Buffer.alloc(hdrSize);
          fs.readSync(fd, linkBuf, 0, hdrSize, filePos);
          longLink = linkBuf.toString("utf8").replace(/\0+$/, "");
        }
        filePos += paddedSize;
        continue;
      }

      // PAX extended headers (per-entry 'x' or global 'g')
      if (type === "x" || type === "g") {
        if (hdrSize > 0) {
          const paxBuf = Buffer.alloc(hdrSize);
          fs.readSync(fd, paxBuf, 0, hdrSize, filePos);
          if (type === "x") {
            paxAttrs = {};
            const paxStr = paxBuf.toString("utf8");
            const lines = paxStr.split("\n");
            for (const line of lines) {
              const m = line.match(/^\d+ ([^=]+)=(.*)/);
              if (m) paxAttrs[m[1]] = m[2];
            }
          }
        }
        filePos += paddedSize;
        continue;
      }

      // Parse entry name
      let entryName;
      if (paxAttrs && paxAttrs.path) {
        entryName = paxAttrs.path;
      } else if (longName) {
        entryName = longName;
      } else {
        const prefix = hdrBuf.toString("utf8", 345, 500).replace(/\0.*/g, "");
        const name = hdrBuf.toString("utf8", 0, 100).replace(/\0.*/g, "");
        entryName = prefix ? prefix + "/" + name : name;
      }

      const isDir = type === "5" || (type === "0" && entryName.endsWith("/"));
      if (isDir && !entryName.endsWith("/")) entryName += "/";

      const mode = parseInt(hdrBuf.toString("utf8", 100, 108).trim(), 8) || 0;
      const mtime = paxAttrs && paxAttrs.mtime
        ? Math.floor(parseFloat(paxAttrs.mtime))
        : (parseInt(hdrBuf.toString("utf8", 136, 148).trim(), 8) || 0);
      let linkname = longLink || (paxAttrs && paxAttrs.linkpath) || hdrBuf.toString("utf8", 157, 257).replace(/\0.*/g, "");

      const entryType = type === "5" ? "directory" : type === "2" ? "symlink" : "file";

      this.entries.push({
        entryName,
        isDirectory: isDir,
        size: hdrSize,
        time: mtime ? new Date(mtime * 1000) : null,
        mode,
        data: null,
        sourceFile: isDir ? null : sourceFile,
        offset: filePos,
        linkname: linkname || null,
        type: entryType,
      });

      count++;
      if (onProgress && count % 50 === 0) {
        onProgress(count, 0);
        await new Promise((r) => setTimeout(r, 0));
      }
      filePos += paddedSize;
      longName = null;
      longLink = null;
      paxAttrs = null;
    }

    fs.closeSync(fd);
    if (onProgress) onProgress(count, count);
  }

  async save(filePath, onProgress, onStatus) {
    const os = require("os");
    // Pack tar to a temp file (streaming, no memory buffering)
    if (this.compression === "none" && this._sourceFile !== filePath) {
      await this._packTarToFile(filePath, onProgress);
    } else if (this.compression === "none") {
      // Same file — use temp to avoid reading from file we're writing
      const tempTar = path.join(os.tmpdir(), "archivesphynx-pack-" + Date.now() + ".tar");
      await this._packTarToFile(tempTar, onProgress);
      await fs.promises.rename(tempTar, filePath).catch(async () => {
        await fs.promises.copyFile(tempTar, filePath);
        fs.unlinkSync(tempTar);
      });
    } else {
      // Compressed: pack to temp tar, then compress using CLI tools
      const tempTar = path.join(os.tmpdir(), "archivesphynx-pack-" + Date.now() + ".tar");
      if (onStatus) { onStatus("Archiving…"); await new Promise((r) => setTimeout(r, 0)); }
      await this._packTarToFile(tempTar, onProgress);
      if (onStatus) { onStatus("Compressing…"); await new Promise((r) => setTimeout(r, 0)); }
      const { spawn, spawnSync } = require("child_process");
      if (this.compression === "bz2") {
        const outFd = fs.openSync(filePath, "w");
        const ok = await new Promise((resolve, reject) => {
          const proc = spawn(getBzip2Path(), ["-k", "-c", tempTar], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          bzip2FallbackUsed = true;
          await this._sphynxCompressFromTar(tempTar, filePath, FILTER.BZIP2);
          fs.unlinkSync(tempTar);
          return;
        }
      } else {
        // gz, xz, zst — use async spawn, with JS fallbacks
        let cmd, args;
        if (this.compression === "gz") { cmd = getGzipPath(); args = ["-c", tempTar]; }
        else if (this.compression === "xz") { cmd = getXzPath(); args = ["-c", tempTar]; }
        else if (this.compression === "zst") { cmd = getZstdPath(); args = ["-c", "--no-progress", "-3", tempTar]; }
        const outFd = fs.openSync(filePath, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(cmd, args, { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          if (this.compression === "gz") {
            await this._sphynxCompressFromTar(tempTar, filePath, FILTER.GZIP);
          } else if (this.compression === "xz") {
            await this._sphynxCompressFromTar(tempTar, filePath, FILTER.XZ);
          } else if (this.compression === "zst") {
            await this._streamingZstdCompress(tempTar, filePath);
          }
        }
      }
      // Keep tempTar as the working copy for offset access (skip decompression)
      if (this._tempFile) { try { fs.unlinkSync(this._tempFile); } catch {} }
      this._tempFile = tempTar;
      this._sourceFile = tempTar;
      this.entries = [];
      if (onStatus) { onStatus("Reloading…"); await new Promise((r) => setTimeout(r, 0)); }
      return this._parseOffsets(onProgress);
    }

    await new Promise((r) => setTimeout(r, 0));
    // Re-open with offsets (uncompressed tar only)
    if (onStatus) { onStatus("Reloading…"); await new Promise((r) => setTimeout(r, 0)); }
    if (this._tempFile) { try { fs.unlinkSync(this._tempFile); } catch {} }
    this._tempFile = null;
    if (this.compression === "none") {
      // Offsets already updated by _packTarToFile if using IPC path
      if (this._sourceFile !== filePath) {
        this._sourceFile = filePath;
        this.entries = [];
        return this._parseOffsets(onProgress);
      }
      // else: already updated by the IPC handler's returned offsets
    }
  }

  async _sphynxCompressFromTar(tarPath, outPath, filter) {
    const reader = await StreamingReader.openFile(tarPath);
    const filterName = ["NONE", "GZIP", "BZIP2", "XZ", "ZSTD"][filter] || "NONE";
    const writer = await StreamingWriter.createFile(outPath, "TAR", filterName);
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

  async _streamingZstdCompress(tarPath, outPath) {
    const stat = fs.statSync(tarPath);
    if (stat.size > 2 * 1024 * 1024 * 1024) {
      throw new Error("Zstd fallback not supported for files > 2 GiB. Install zstd CLI and configure its path in Settings.");
    }
    const tarBuf = fs.readFileSync(tarPath);
    fs.writeFileSync(outPath, await zstdCompress(tarBuf));
  }

  _packTarToFile(outPath, onProgress) {
    return this._packTarToFileLocal(outPath, onProgress);
  }

  async _packTarToFileLocal(outPath, onProgress) {
    const total = this.entries.length;
    const fdOut = fs.openSync(outPath, "w");
    let outPos = 0;
    const cpBuf = Buffer.allocUnsafe(4 * 1024 * 1024);

    for (let idx = 0; idx < total; idx++) {
      const entry = this.entries[idx];
      const isDir = entry.isDirectory;
      const name = entry.entryName;
      const size = isDir ? 0 : (entry.data ? entry.data.length : entry.size || 0);

      // GNU @LongLink for names > 100 chars
      if (name.length > 100) {
        const linkData = Buffer.from(name + "\0");
        const lh = Buffer.alloc(512);
        lh.write("././@LongLink", 0);
        lh.write("0000000\0", 100); lh.write("0000000\0", 108); lh.write("0000000\0", 116);
        lh.write(linkData.length.toString(8).padStart(11, "0") + "\0", 124);
        lh.write("00000000000\0", 136); lh.write("        ", 148);
        lh[156] = 76;
        lh.write("ustar ", 257); lh.write(" \0", 263);
        let ck = 0; for (let j = 0; j < 512; j++) ck += lh[j];
        lh.write(ck.toString(8).padStart(6, "0") + "\0 ", 148);
        fs.writeSync(fdOut, lh, 0, 512, outPos); outPos += 512;
        fs.writeSync(fdOut, linkData, 0, linkData.length, outPos); outPos += linkData.length;
        const lpad = (512 - (linkData.length % 512)) % 512;
        if (lpad > 0) { fs.writeSync(fdOut, Buffer.alloc(lpad), 0, lpad, outPos); outPos += lpad; }
      }

      // Header
      const header = Buffer.alloc(512);
      header.write(name.slice(0, 100), 0);
      header.write((entry.mode || (isDir ? 0o755 : 0o644)).toString(8).padStart(7, "0") + "\0", 100);
      header.write("0000000\0", 108); header.write("0000000\0", 116);
      header.write(size.toString(8).padStart(11, "0") + "\0", 124);
      const mt = entry.time ? Math.floor(new Date(entry.time).getTime() / 1000) : 0;
      header.write(mt.toString(8).padStart(11, "0") + "\0", 136);
      header.write("        ", 148);
      if (isDir) header[156] = 53;
      else if (entry.type === "symlink") { header[156] = 50; if (entry.linkname) header.write(entry.linkname.slice(0, 100), 157); }
      else header[156] = 48;
      header.write("ustar\0", 257); header.write("00", 263);
      let cksum = 0; for (let j = 0; j < 512; j++) cksum += header[j];
      header.write(cksum.toString(8).padStart(6, "0") + "\0 ", 148);
      fs.writeSync(fdOut, header, 0, 512, outPos); outPos += 512;

      // Data
      if (!isDir && entry.type !== "symlink" && size > 0) {
        if (entry.data) {
          fs.writeSync(fdOut, entry.data, 0, entry.data.length, outPos);
          outPos += entry.data.length;
        } else if (entry.filePath) {
          const fdSrc = fs.openSync(entry.filePath, "r");
          let remaining = size, srcPos = 0;
          while (remaining > 0) {
            const toRead = Math.min(cpBuf.length, remaining);
            const n = fs.readSync(fdSrc, cpBuf, 0, toRead, srcPos);
            if (n === 0) break;
            fs.writeSync(fdOut, cpBuf, 0, n, outPos);
            srcPos += n; outPos += n; remaining -= n;
          }
          fs.closeSync(fdSrc);
        } else if (entry.sourceFile) {
          const fdSrc = fs.openSync(entry.sourceFile, "r");
          let remaining = size, srcPos = entry.offset;
          while (remaining > 0) {
            const toRead = Math.min(cpBuf.length, remaining);
            const n = fs.readSync(fdSrc, cpBuf, 0, toRead, srcPos);
            if (n === 0) break;
            fs.writeSync(fdOut, cpBuf, 0, n, outPos);
            srcPos += n; outPos += n; remaining -= n;
          }
          fs.closeSync(fdSrc);
        }
        const pad = (512 - (size % 512)) % 512;
        if (pad > 0) { fs.writeSync(fdOut, Buffer.alloc(pad), 0, pad, outPos); outPos += pad; }
      }
      if (onProgress && idx % 500 === 0) { onProgress(idx + 1, total); await new Promise((r) => setTimeout(r, 0)); }
    }
    if (onProgress) onProgress(total, total);
    // End-of-archive marker
    fs.writeSync(fdOut, Buffer.alloc(1024), 0, 1024, outPos);
    fs.closeSync(fdOut);
  }

  _getEntryData(entry) {
    if (entry.data) return entry.data;
    if (entry.sourceFile && entry.size > 0) {
      const fd = fs.openSync(entry.sourceFile, "r");
      const buf = Buffer.allocUnsafe(entry.size);
      fs.readSync(fd, buf, 0, entry.size, entry.offset);
      fs.closeSync(fd);
      return buf;
    }
    return Buffer.alloc(0);
  }

  refresh() {}

  getEntries() {
    return this.entries.map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.size || (e.data ? e.data.length : 0),
      compressedSize: 0,
      time: e.time,
      method: this.compression === "none" ? "Store" : this.compression.toUpperCase(),
      attr: e.mode ? (e.mode << 16) : 0,
    }));
  }

  addFile(entryName, data) {
    this.entries.push({
      entryName,
      isDirectory: entryName.endsWith("/"),
      size: data.length,
      time: new Date(),
      mode: entryName.endsWith("/") ? 0o755 : 0o644,
      data: entryName.endsWith("/") ? null : data,
      sourceFile: null,
      offset: 0,
    });
  }

  deleteFile(entryName) {
    this.entries = this.entries.filter((e) => e.entryName !== entryName);
  }

  renameEntry(oldPath, newPath) {
    if (oldPath.endsWith("/")) {
      this.entries.forEach((e) => {
        if (e.entryName.startsWith(oldPath)) {
          e.entryName = newPath + e.entryName.slice(oldPath.length);
        }
      });
    } else {
      const entry = this.entries.find((e) => e.entryName === oldPath);
      if (entry) entry.entryName = newPath;
    }
  }

  getEntry(entryName) {
    return this.entries.find((e) => e.entryName === entryName) || null;
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry) return null;
    return this._getEntryData(entry);
  }

  extractEntry(entryName, dest) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry) return;
    const mapped = remapExtractPath(entry.entryName);
    if (!mapped) return;
    const outPath = path.join(dest, mapped);
    if (entry.isDirectory) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const data = this._getEntryData(entry);
      if (data) fs.writeFileSync(outPath, data);
    }
    if (entry.time) {
      try { fs.utimesSync(outPath, entry.time, entry.time); } catch {}
    }
  }

  async extractAll(dest, onProgress) {
    const total = this.entries.length;
    for (let i = 0; i < total; i++) {
      this.extractEntry(this.entries[i].entryName, dest);
      if (onProgress && i % 100 === 0) {
        onProgress(i + 1, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    mergeResourceForks(dest);
    // Set directory timestamps (explicit + inferred from file mtimes)
    const dirTimes = new Map();
    for (const e of this.entries) {
      const mapped = remapExtractPath(e.entryName);
      if (!mapped || !e.time) continue;
      const t = e.time instanceof Date ? e.time : new Date(e.time * 1000);
      if (e.isDirectory) {
        dirTimes.set(path.join(dest, mapped), t);
      } else {
        let parent = path.dirname(path.join(dest, mapped));
        while (parent.length > dest.length) {
          const existing = dirTimes.get(parent);
          if (!existing || t > existing) dirTimes.set(parent, t);
          parent = path.dirname(parent);
        }
      }
    }
    const sortedDirs = [...dirTimes.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [p, t] of sortedDirs) {
      try { fs.utimesSync(p, t, t); } catch {}
    }
    if (onProgress) onProgress(total, total);
  }

  testIntegrity() {
    const errors = [];
    for (const entry of this.entries) {
      if (entry.isDirectory) continue;
      try {
        const data = this._getEntryData(entry);
        if (!data) errors.push(entry.entryName + ": no data available");
      } catch (e) {
        errors.push(entry.entryName + ": " + e.message);
      }
    }
    return errors;
  }
}

// ─── 7z Backend (standalone .7z) ───

class SevenZipArchive {
  constructor() {
    this.entries = [];
    this.format = "7z";
    this._filePath = null;
    this._cacheDir = null;
  }

  _is7zAvailable() {
    try {
      const { spawnSync } = require("child_process");
      const r = spawnSync(getSevenZipPath(), ["--help"], { stdio: "ignore" });
      return !r.error && (r.status === 0 || r.status === 7);
    } catch { return false; }
  }

  _clearCache() {
    if (this._cacheDir) {
      try { fs.rmSync(this._cacheDir, { recursive: true, force: true }); } catch {}
      this._cacheDir = null;
    }
  }

  create() {
    this._clearCache();
    this.entries = [];
    this._filePath = null;
  }

  async open(filePath, onProgress) {
    this._clearCache();
    this._filePath = filePath;
    this.entries = [];
    if (this._is7zAvailable()) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(getSevenZipPath(), ["l", "-slt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
      if (result.status === 0) {
        const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = ") && !b.includes("Type = ") && !b.includes("Physical Size"));
        for (let i = 0; i < blocks.length; i++) {
          const lines = blocks[i].split("\n");
          const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
          const entryPath = get("Path");
          if (!entryPath) continue;
          const isDir = get("Folder") === "+" || get("Attributes").startsWith("D");
          const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
          const size = parseInt(get("Size"), 10) || 0;
          const compressed = get("Packed Size") ? parseInt(get("Packed Size"), 10) : -1;
          const mtime = get("Modified") ? new Date(get("Modified")) : null;
          const method = get("Method") || "LZMA2";
          this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method });
          if (onProgress) onProgress(i, blocks.length - 1);
        }
        return;
      }
    }
    // Sphynx fallback (seekable file reader — supports >2GB via NODERAWFS)
    const reader = await StreamingReader.openFileSeekable(filePath);
    let count = 0;
    for (const entry of reader) {
      let size = entry.size;
      if (!entry.isDirectory && size === 0) {
        size = reader.readAll().length;
      }
      this.entries.push({
        entryName: entry.pathname,
        isDirectory: entry.isDirectory,
        size,
        compressedSize: 0,
        time: entry.mtime ? new Date(entry.mtime * 1000) : null,
        method: "LZMA2",
      });
      count++;
      if (onProgress && count % 50 === 0) {
        onProgress(count, 0);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    reader.close();
    if (onProgress) onProgress(count, count);
  }

  async save(filePath, onProgress) {
    let usedCli = false;
    if (this._is7zAvailable()) {
      try {
      const os = require("os");
      const { spawn } = require("child_process");
      const tempDir = path.join(os.tmpdir(), "archivesphynx-7z-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      if (this._filePath && fs.existsSync(this._filePath)) {
        await new Promise((resolve, reject) => {
          const proc = spawn(getSevenZipPath(), ["x", "-o" + tempDir, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
          proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("7z extraction failed")));
          proc.on("error", reject);
        });
      }
      const total = this.entries.length;
      for (let i = 0; i < total; i++) {
        const e = this.entries[i];
        const outPath = path.join(tempDir, ...e.entryName.replace(/\/$/, "").split("/"));
        if (e.isDirectory) {
          fs.mkdirSync(outPath, { recursive: true });
        } else if (e._data) {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, e._data);
        }
        if (onProgress && i % 100 === 0) onProgress(i, total);
      }
      if (this._deleted && this._deleted.length > 0) {
        for (const name of this._deleted) {
          const target = path.join(tempDir, ...name.replace(/\/$/, "").split("/"));
          try {
            const stat = fs.statSync(target);
            if (stat.isDirectory()) fs.rmSync(target, { recursive: true });
            else fs.unlinkSync(target);
          } catch {}
        }
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await new Promise((resolve, reject) => {
        const proc = spawn(getSevenZipPath(), ["a", "-t7z", filePath, path.join(tempDir, "*")], { stdio: ["ignore", "pipe", "pipe"] });
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("Failed to create 7z archive")));
        proc.on("error", reject);
      });
      fs.rmSync(tempDir, { recursive: true, force: true });
      usedCli = true;
      } catch (e) {
        if (!e.message.includes("ENOENT") && !e.message.includes("spawn")) throw e;
      }
    }
    if (!usedCli) {
      // Sphynx fallback — 7z writer buffers all data internally, limit to 2GB
      const totalSize = this.entries.reduce((sum, e) => sum + (e.size || 0), 0);
      if (totalSize > 2 * 1024 * 1024 * 1024) {
        throw new Error("7z CLI not available. Writing 7z archives larger than 2 GiB requires the 7-Zip CLI. Install it and configure its path in Settings.");
      }
      const writer = await StreamingWriter.createFile(filePath, "SEVENZIP", "NONE");
      for (const e of this.entries) {
        if (e.isDirectory) {
          writer.addDirectory(e.entryName, { mtime: e.time ? Math.floor(e.time.getTime() / 1000) : undefined });
        } else {
          const data = e._data || this._getDataSphynx(e.entryName);
          if (data) writer.addFile(e.entryName, data, { mtime: e.time ? Math.floor(e.time.getTime() / 1000) : undefined });
        }
      }
      writer.finish();
    }
    this._filePath = filePath;
    this._deleted = [];
    this.entries = [];
    await this.open(filePath, onProgress);
  }

  refresh() {}

  getEntries() {
    return this.entries.map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.size,
      compressedSize: e.compressedSize || 0,
      time: e.time,
      method: e.method || "LZMA2",
      attr: 0,
    }));
  }

  addFile(entryName, data) {
    this.entries.push({
      entryName,
      isDirectory: entryName.endsWith("/"),
      size: data.length,
      compressedSize: 0,
      time: new Date(),
      method: "LZMA2",
      _data: entryName.endsWith("/") ? null : data,
    });
  }

  deleteFile(entryName) {
    if (!this._deleted) this._deleted = [];
    this._deleted.push(entryName);
    this.entries = this.entries.filter((e) => e.entryName !== entryName);
  }

  renameEntry(oldPath, newPath) {
    if (oldPath.endsWith("/")) {
      this.entries.forEach((e) => {
        if (e.entryName.startsWith(oldPath)) {
          e.entryName = newPath + e.entryName.slice(oldPath.length);
        }
      });
    } else {
      const entry = this.entries.find((e) => e.entryName === oldPath);
      if (entry) entry.entryName = newPath;
    }
  }

  getEntry(entryName) {
    return this.entries.find((e) => e.entryName === entryName) || null;
  }

  _ensureCache() {
    if (this._cacheDir) return;
    if (!this._filePath) return;
    const os = require("os");
    this._cacheDir = path.join(os.tmpdir(), "archivesphynx-7zcache-" + Date.now());
    fs.mkdirSync(this._cacheDir, { recursive: true });
    if (this._is7zAvailable()) {
      const { spawnSync } = require("child_process");
      spawnSync(getSevenZipPath(), ["x", "-o" + this._cacheDir, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
    } else {
      // Sphynx fallback: extract all via seekable file reader
      const { _getModuleSync } = require("sphynx");
      const mod = _getModuleSync();
      if (!mod) return;
      const ptr = mod._reader_new();
      const r = mod.ccall("reader_open_filename", "number", ["number", "string"], [ptr, this._filePath]);
      if (r !== 0) { mod._reader_close(ptr); return; }
      while (mod._reader_next(ptr) === 0) {
        const name = mod.UTF8ToString(mod._entry_pathname());
        const isDir = !!mod._entry_is_dir();
        const outPath = path.join(this._cacheDir, ...name.split("/"));
        if (isDir) {
          fs.mkdirSync(outPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          const chunks = [];
          const readBuf = mod._malloc(262144);
          let n;
          while ((n = mod._reader_read_data(ptr, readBuf, 262144)) > 0) {
            chunks.push(Buffer.from(mod.HEAPU8.slice(readBuf, readBuf + n)));
          }
          mod._free(readBuf);
          fs.writeFileSync(outPath, Buffer.concat(chunks));
        }
      }
      mod._reader_close(ptr);
    }
  }

  _getDataSphynx(entryName) {
    if (!this._filePath) return null;
    const { _getModuleSync } = require("sphynx");
    const mod = _getModuleSync();
    if (!mod) return null;
    const ptr = mod._reader_new();
    const r = mod.ccall("reader_open_filename", "number", ["number", "string"], [ptr, this._filePath]);
    if (r !== 0) { mod._reader_close(ptr); return null; }
    let result = null;
    while (mod._reader_next(ptr) === 0) {
      const name = mod.UTF8ToString(mod._entry_pathname());
      if (name === entryName) {
        const chunks = [];
        const readBuf = mod._malloc(262144);
        let n;
        while ((n = mod._reader_read_data(ptr, readBuf, 262144)) > 0) {
          chunks.push(Buffer.from(mod.HEAPU8.slice(readBuf, readBuf + n)));
        }
        mod._free(readBuf);
        result = Buffer.concat(chunks);
        break;
      }
    }
    mod._reader_close(ptr);
    return result;
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (entry._data) return entry._data;
    if (!this._filePath) return null;
    this._ensureCache();
    const cached = path.join(this._cacheDir, ...entryName.split("/"));
    try { return fs.readFileSync(cached); } catch { return this._getDataSphynx(entryName); }
  }

  extractEntry(entryName, dest) {
    if (!this._filePath) return;
    if (this._is7zAvailable()) {
      const { spawnSync } = require("child_process");
      spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"] });
    } else {
      const data = this._getDataSphynx(entryName);
      if (data) {
        const outPath = path.join(dest, entryName);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, data);
      }
    }
  }

  async extractAll(dest) {
    if (!this._filePath) return;
    if (this._is7zAvailable()) {
      const { spawn } = require("child_process");
      await new Promise((resolve) => {
        const proc = spawn(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
        proc.on("close", resolve);
        proc.on("error", resolve);
      });
    } else {
      const reader = await StreamingReader.openFileSeekable(this._filePath);
      const dirs = [];
      for (const entry of reader) {
        const mapped = remapExtractPath(entry.pathname);
        if (!mapped) continue;
        const outPath = path.join(dest, mapped);
        if (entry.isDirectory) {
          fs.mkdirSync(outPath, { recursive: true });
          if (entry.mtime) dirs.push({ path: outPath, mtime: new Date(entry.mtime * 1000) });
        } else {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, reader.readAll());
          if (entry.mtime) {
            try { fs.utimesSync(outPath, new Date(entry.mtime * 1000), new Date(entry.mtime * 1000)); } catch {}
          }
        }
      }
      reader.close();
      mergeResourceForks(dest);
      // Infer directory timestamps from children
      for (const e of this.entries) {
        if (e.isDirectory || !e.time) continue;
        const mapped = remapExtractPath(e.entryName);
        if (!mapped) continue;
        const t = e.time instanceof Date ? e.time : new Date(e.time * 1000);
        let parent = path.dirname(path.join(dest, mapped));
        while (parent.length > dest.length) {
          const existing = dirs.find(d => d.path === parent);
          if (existing) { if (t > existing.mtime) existing.mtime = t; }
          else dirs.push({ path: parent, mtime: t });
          parent = path.dirname(parent);
        }
      }
      dirs.sort((a, b) => b.path.length - a.path.length);
      for (const d of dirs) {
        try { fs.utimesSync(d.path, d.mtime, d.mtime); } catch {}
      }
    }
    mergeResourceForks(dest);
  }

  async testIntegrity() {
    if (!this._filePath) return [];
    if (this._is7zAvailable()) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(getSevenZipPath(), ["t", this._filePath], { encoding: "utf8" });
      if (result.status === 0) return [];
      return ["Archive integrity test failed: " + (result.stderr || result.stdout || "unknown error")];
    }
    // Sphynx fallback: try to read all entries
    const errors = [];
    try {
      const reader = await StreamingReader.openFileSeekable(this._filePath);
      for (const entry of reader) {
        if (!entry.isDirectory) {
          try { reader.readAll(); }
          catch (e) { errors.push(entry.pathname + ": " + e.message); }
        }
      }
      reader.close();
    } catch (e) {
      errors.push("Archive: " + e.message);
    }
    return errors;
  }
}

// ─── RAR Backend (read-only) ───

let unrarPath = "unrar";
function getUnrarPath() { return unrarPath; }
function setUnrarPath(p) { if (p) unrarPath = p; }

class RarArchive {
  constructor() {
    this.entries = [];
    this.format = "rar";
    this._filePath = null;
  }

  create() {
    throw new Error("Creating RAR archives is not supported. RAR is a proprietary format — use 7z or zip instead.");
  }

  async open(filePath, onProgress) {
    this._filePath = filePath;
    this.entries = [];
    const { spawnSync } = require("child_process");
    // Try 7z first (more commonly available), fall back to unrar
    let result = spawnSync(getSevenZipPath(), ["l", "-slt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0) {
      result = spawnSync(getUnrarPath(), ["lt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
      if (result.status !== 0) throw new Error("Failed to list RAR archive. Ensure 7z or unrar is installed.");
      this._parseUnrarOutput(result.stdout, onProgress);
      return;
    }
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = ") && !b.includes("Type = ") && !b.includes("Physical Size"));
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+" || get("Attributes").startsWith("D");
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = get("Packed Size") ? parseInt(get("Packed Size"), 10) : -1;
      const mtime = get("Modified") ? new Date(get("Modified")) : null;
      const method = get("Method") || "RAR";
      this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method });
      if (onProgress) onProgress(i, blocks.length - 1);
    }
  }

  _parseUnrarOutput(stdout, onProgress) {
    const blocks = stdout.split(/\n\n/).filter((b) => b.includes("Name:"));
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split("\n").map((l) => l.trim());
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + ":")); return l ? l.slice(key.length + 1).trim() : ""; };
      const entryPath = get("Name");
      if (!entryPath) continue;
      const isDir = get("Type") === "Directory";
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = parseInt(get("Packed size"), 10) || 0;
      const mtime = get("mtime") ? new Date(get("mtime")) : null;
      this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method: "RAR" });
      if (onProgress) onProgress(i + 1, blocks.length);
    }
  }

  async save() {
    throw new Error("Saving RAR archives is not supported. RAR is a proprietary format — use Save As to convert to 7z or zip.");
  }

  refresh() {}

  getEntries() {
    return this.entries.map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.size,
      compressedSize: e.compressedSize || 0,
      time: e.time,
      method: e.method || "RAR",
      attr: 0,
    }));
  }

  addFile() {
    throw new Error("Cannot modify RAR archives. Use Save As to convert to a writable format.");
  }

  deleteFile() {
    throw new Error("Cannot modify RAR archives. Use Save As to convert to a writable format.");
  }

  renameEntry() {
    throw new Error("Cannot modify RAR archives. Use Save As to convert to a writable format.");
  }

  getEntry(entryName) {
    return this.entries.find((e) => e.entryName === entryName) || null;
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (!this._filePath) return null;
    const { spawnSync } = require("child_process");
    // Try 7z first
    let result = spawnSync(getSevenZipPath(), ["e", "-so", "-y", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    if (result.status === 0 && result.stdout && result.stdout.length > 0) return result.stdout;
    // Fall back to unrar
    result = spawnSync(getUnrarPath(), ["p", "-inul", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    return result.stdout || null;
  }

  extractEntry(entryName, dest) {
    if (!this._filePath) return;
    const { spawnSync } = require("child_process");
    let result = spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) {
      spawnSync(getUnrarPath(), ["x", "-o+", this._filePath, entryName.replace(/\//g, path.sep), dest + path.sep], { stdio: ["ignore", "pipe", "pipe"] });
    }
  }

  async extractAll(dest) {
    if (!this._filePath) return;
    const { spawn, spawnSync } = require("child_process");
    const code = await new Promise((resolve) => {
      const proc = spawn(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });
    if (code !== 0) {
      spawnSync(getUnrarPath(), ["x", "-o+", this._filePath, dest + path.sep], { stdio: ["ignore", "pipe", "pipe"] });
    }
  }

  testIntegrity() {
    if (!this._filePath) return [];
    const { spawnSync } = require("child_process");
    let result = spawnSync(getSevenZipPath(), ["t", this._filePath], { encoding: "utf8" });
    if (result.status === 0) return [];
    result = spawnSync(getUnrarPath(), ["t", this._filePath], { encoding: "utf8" });
    if (result.status === 0) return [];
    return ["Archive integrity test failed: " + (result.stderr || result.stdout || "unknown error")];
  }
}

// ─── JAR Backend (ZIP-based) ───

class JarArchive extends ZipArchive {
  constructor() {
    super();
    this.format = "jar";
  }
}

// ─── Read-only 7z-based backend (shared by DEB, RPM, DMG, ISO) ───

class SevenZipReadOnlyArchive {
  constructor(format) {
    this.entries = [];
    this.format = format;
    this._filePath = null;
  }

  create() {
    throw new Error("Creating " + this.format.toUpperCase() + " archives is not supported.");
  }

  async open(filePath, onProgress) {
    this._filePath = filePath;
    this.entries = [];
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["l", "-slt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0 && !result.stdout) throw new Error("Failed to list " + this.format + " archive: " + (result.stderr || "unknown error").trim());
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = ") && !b.includes("Type = ") && !b.includes("Physical Size"));
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+" || get("Attributes").startsWith("D");
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = get("Packed Size") ? parseInt(get("Packed Size"), 10) : -1;
      const mtime = get("Modified") ? new Date(get("Modified")) : null;
      const method = get("Method") || "";
      this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method });
      if (onProgress) onProgress(i, blocks.length - 1);
    }
  }

  async save() {
    throw new Error("Saving " + this.format.toUpperCase() + " archives is not supported. Use Save As to convert to a writable format.");
  }

  refresh() {}

  getEntries() {
    return this.entries.map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.size,
      compressedSize: e.compressedSize || 0,
      time: e.time,
      method: e.method || this.format.toUpperCase(),
      attr: 0,
    }));
  }

  addFile() { throw new Error("Cannot modify " + this.format.toUpperCase() + " archives."); }
  deleteFile() { throw new Error("Cannot modify " + this.format.toUpperCase() + " archives."); }
  renameEntry() { throw new Error("Cannot modify " + this.format.toUpperCase() + " archives."); }

  getEntry(entryName) {
    return this.entries.find((e) => e.entryName === entryName) || null;
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (!this._filePath) return null;
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["e", "-so", "-y", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    return result.stdout || null;
  }

  extractEntry(entryName, dest) {
    if (!this._filePath) return;
    const { spawnSync } = require("child_process");
    spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"] });
  }

  async extractAll(dest) {
    if (!this._filePath) return;
    const { spawn } = require("child_process");
    await new Promise((resolve) => {
      const proc = spawn(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", resolve);
      proc.on("error", resolve);
    });
  }

  testIntegrity() {
    if (!this._filePath) return [];
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["t", this._filePath], { encoding: "utf8" });
    if (result.status === 0) return [];
    return ["Archive integrity test failed: " + (result.stderr || result.stdout || "unknown error")];
  }
}

class DebArchive extends SevenZipReadOnlyArchive {
  constructor() { super("deb"); }
}

class RpmArchive extends SevenZipReadOnlyArchive {
  constructor() { super("rpm"); }

  async open(filePath, onProgress) {
    this._filePath = filePath;
    this.entries = [];
    const os = require("os");
    const { spawnSync } = require("child_process");
    // Stage 1: extract RPM to get inner cpio
    const tempDir = path.join(os.tmpdir(), "archivesphynx-rpm-" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    spawnSync(getSevenZipPath(), ["x", "-y", "-o" + tempDir, filePath], { stdio: ["ignore", "pipe", "pipe"] });
    // Find the inner cpio file
    const inner = fs.readdirSync(tempDir).find((f) => f.includes("cpio"));
    if (!inner) { fs.rmSync(tempDir, { recursive: true, force: true }); return; }
    const innerPath = path.join(tempDir, inner);
    // Stage 2: if compressed cpio, decompress it
    let cpioPath = innerPath;
    if (inner.endsWith(".zstd") || inner.endsWith(".zst")) {
      cpioPath = innerPath.replace(/\.zst(d)?$/, "");
      try {
        execFileSync(getZstdPath(), ["-d", "-f", innerPath, "-o", cpioPath], { stdio: "ignore" });
      } catch {
        const buf = fs.readFileSync(innerPath);
        const reader = await ArchiveReader.open(buf);
        const chunks = [];
        let entry;
        while ((entry = reader.next()) !== null) {
          if (!entry.isDirectory) chunks.push(reader.readAll());
        }
        reader.close();
        fs.writeFileSync(cpioPath, Buffer.concat(chunks));
      }
    } else if (inner.endsWith(".gz")) {
      cpioPath = innerPath.replace(/\.gz$/, "");
      fs.writeFileSync(cpioPath, zlib.gunzipSync(fs.readFileSync(innerPath)));
    } else if (inner.endsWith(".xz") || inner.endsWith(".lzma")) {
      cpioPath = innerPath.replace(/\.(xz|lzma)$/, "");
      const decompressed = await xzDecompress(fs.readFileSync(innerPath));
      fs.writeFileSync(cpioPath, decompressed);
    }
    // Stage 3: list the cpio using 7z
    this._innerPath = cpioPath;
    this._tempDir = tempDir;
    const result = spawnSync(getSevenZipPath(), ["l", "-slt", cpioPath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0) { fs.rmSync(tempDir, { recursive: true, force: true }); return; }
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = ") && !b.includes("Physical Size"));
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+" || get("Attributes").startsWith("D");
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = get("Packed Size") ? parseInt(get("Packed Size"), 10) : -1;
      const mtime = get("Modified") ? new Date(get("Modified")) : null;
      this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method: "" });
      if (onProgress) onProgress(i, blocks.length);
    }
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (!this._innerPath) return null;
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["e", "-so", "-y", this._innerPath, entryName.replace(/\//g, path.sep)], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity });
    return result.stdout || null;
  }

  async extractAll(dest) {
    if (!this._innerPath) return;
    const { spawn } = require("child_process");
    await new Promise((resolve) => {
      const proc = spawn(getSevenZipPath(), ["x", "-o" + dest, "-y", this._innerPath], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });
  }
}

class DmgArchive extends SevenZipReadOnlyArchive {
  constructor() { super("dmg"); }
}

class IsoArchive extends SevenZipReadOnlyArchive {
  constructor() { super("iso"); }
}

// ─── Factory ───

function createArchive(filePath) {
  const fmt = detectFormat(filePath);
  switch (fmt) {
    case "zip": return new ZipArchive();
    case "tar": return new TarArchive("none");
    case "tar.gz": return new TarArchive("gz");
    case "tar.bz2": return new TarArchive("bz2");
    case "tar.xz": return new TarArchive("xz");
    case "tar.zst": return new TarArchive("zst");
    case "7z": return new SevenZipArchive();
    case "rar": return new RarArchive();
    case "jar": return new JarArchive();
    case "deb": return new DebArchive();
    case "rpm": return new RpmArchive();
    case "dmg": return new DmgArchive();
    case "iso": return new IsoArchive();
    default: return null;
  }
}

function openArchive(filePath) {
  const archive = createArchive(filePath);
  if (!archive) return null;
  return archive;
}

module.exports = { detectFormat, createArchive, setZstdPath, setBzip2Path, setGzipPath, setXzPath, setSevenZipPath, getSevenZipPath, setUnrarPath, isZstdAvailable, wasBzip2FallbackUsed, ZipArchive, TarArchive, SevenZipArchive, RarArchive, JarArchive, DebArchive, RpmArchive, DmgArchive, IsoArchive };

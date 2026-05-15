const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const tar = require("tar-stream");
const unbzip2 = require("unbzip2-stream");
const bzip2 = require("compressjs").Bzip2;
const fzstd = require("fzstd");
const { execFileSync } = require("child_process");

// XZ/LZMA fallback: try lzma-native, then lzma-purejs
let _lzma = null;
function getLzma() {
  if (_lzma) return _lzma;
  try { _lzma = { type: "native", mod: require("lzma-native") }; }
  catch { _lzma = { type: "pure", mod: require("lzma-purejs") }; }
  return _lzma;
}

function xzDecompress(buf) {
  const lzma = getLzma();
  if (lzma.type === "native") {
    return lzma.mod.decompress(buf);
  }
  // lzma-purejs: decompress raw LZMA stream (xz container must be stripped)
  return Buffer.from(lzma.mod.decompressFile(buf));
}

function xzCompress(buf) {
  const lzma = getLzma();
  if (lzma.type === "native") {
    return lzma.mod.compress(buf, { preset: 6 });
  }
  return Buffer.from(lzma.mod.compressFile(buf));
}

let zstdPath = "zstd";
function getZstdPath() { return zstdPath; }
function setZstdPath(p) { if (p) zstdPath = p; }

function isZstdAvailable() {
  return true;
}

function isZstdCliAvailable() {
  try {
    execFileSync(getZstdPath(), ["--version"], { stdio: "ignore" });
    return true;
  } catch { return false; }
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
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) return "tar.bz2";
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return "tar.xz";
  if (lower.endsWith(".tar.zst") || lower.endsWith(".tzst")) return "tar.zst";
  if (lower.endsWith(".tar.7z") || lower.endsWith(".t7z")) return "tar.7z";
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
    this._admZipCache = null;
  }

  create() {
    this.entries = [];
    this._sourceFile = null;
    this._admZipCache = null;
  }

  async open(filePath, onProgress) {
    const yauzl = require("yauzl");
    this._sourceFile = filePath;
    this._admZipCache = null;
    this.entries = [];
    await new Promise((resolve, reject) => {
      yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
        if (err) return reject(err);
        const total = zipfile.entryCount;
        let count = 0;
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          this.entries.push({
            entryName: entry.fileName,
            isDirectory: entry.fileName.endsWith("/"),
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            time: entry.getLastModDate(),
            method: entry.compressionMethod === 8 ? "Deflate" : entry.compressionMethod === 0 ? "Store" : String(entry.compressionMethod),
            attr: entry.externalFileAttributes,
            _data: null,
            _offset: entry.relativeOffsetOfLocalHeader,
          });
          count++;
          if (onProgress && count % 500 === 0) onProgress(count, total);
          zipfile.readEntry();
        });
        zipfile.on("end", () => {
          if (onProgress) onProgress(total, total);
          resolve();
        });
        zipfile.on("error", reject);
      });
    });
  }

  async save(filePath) {
    const yazl = require("yazl");
    const zipfile = new yazl.ZipFile();
    for (const e of this.entries) {
      if (e.isDirectory) {
        zipfile.addEmptyDirectory(e.entryName.replace(/\/$/, ""), { mtime: e.time || new Date() });
      } else {
        const data = e._data || await this._readEntryData(e);
        zipfile.addBuffer(data, e.entryName, { mtime: e.time || new Date(), mode: e.attr ? (e.attr >>> 16) : 0o644 });
      }
    }
    zipfile.end();
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filePath);
      zipfile.outputStream.pipe(ws);
      ws.on("close", resolve);
      ws.on("error", reject);
    });
    // Re-open to update offsets and compressed sizes
    await this.open(filePath);
  }

  _readEntryData(entry) {
    if (entry._data) return Promise.resolve(entry._data);
    if (!this._sourceFile) return Promise.resolve(Buffer.alloc(0));
    const yauzl = require("yauzl");
    return new Promise((resolve, reject) => {
      yauzl.open(this._sourceFile, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
        if (err) return reject(err);
        zipfile.readEntry();
        zipfile.on("entry", (ze) => {
          if (ze.fileName === entry.entryName) {
            zipfile.openReadStream(ze, (err2, stream) => {
              if (err2) return reject(err2);
              const chunks = [];
              stream.on("data", (c) => chunks.push(c));
              stream.on("end", () => { zipfile.close(); resolve(Buffer.concat(chunks)); });
              stream.on("error", reject);
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("end", () => resolve(Buffer.alloc(0)));
        zipfile.on("error", reject);
      });
    });
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
      _offset: -1,
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
    if (!entry) return null;
    if (entry._data) return entry._data;
    if (!this._sourceFile) return null;
    if (!this._admZipCache) {
      const AdmZip = require("adm-zip");
      this._admZipCache = new AdmZip(this._sourceFile);
    }
    const ze = this._admZipCache.getEntry(entryName);
    return ze ? ze.getData() : null;
  }

  extractEntry(entryName, dest) {
    if (!this._sourceFile) return;
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(this._sourceFile);
    const entry = zip.getEntry(entryName);
    if (entry) zip.extractEntryTo(entry, dest, true, true);
  }

  extractAll(dest) {
    if (!this._sourceFile) return;
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(this._sourceFile);
    zip.extractAllTo(dest, true);
  }

  testIntegrity() {
    const errors = [];
    if (!this._sourceFile) return errors;
    const yauzl = require("yauzl");
    return new Promise((resolve) => {
      yauzl.open(this._sourceFile, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
        if (err) { errors.push("Archive: " + err.message); return resolve(errors); }
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          if (entry.fileName.endsWith("/")) { zipfile.readEntry(); return; }
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2) { errors.push(entry.fileName + ": " + err2.message); zipfile.readEntry(); return; }
            stream.on("data", () => {});
            stream.on("end", () => zipfile.readEntry());
            stream.on("error", (e) => { errors.push(entry.fileName + ": " + e.message); zipfile.readEntry(); });
          });
        });
        zipfile.on("end", () => resolve(errors));
        zipfile.on("error", (e) => { errors.push("Archive: " + e.message); resolve(errors); });
      });
    });
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
      if (this.compression === "7z") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        await new Promise((resolve, reject) => {
          const proc = spawn(getSevenZipPath(), ["e", "-so", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); code === 0 ? resolve() : reject(new Error("7z decompression failed")); });
          proc.on("error", () => {});
        });
      } else if (this.compression === "gz") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(getGzipPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          const input = fs.readFileSync(filePath);
          fs.writeFileSync(this._tempFile, zlib.gunzipSync(input));
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
          const buf = fs.readFileSync(filePath);
          fs.writeFileSync(this._tempFile, Buffer.from(bzip2.decompressFile(buf)));
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
          const buf = fs.readFileSync(filePath);
          const decompressed = await xzDecompress(buf);
          fs.writeFileSync(this._tempFile, decompressed);
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
          const buf = fs.readFileSync(filePath);
          fs.writeFileSync(this._tempFile, Buffer.from(fzstd.decompress(buf)));
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
        try {
          return execFileSync(getBzip2Path(), ["-d", "-c"], { input: buf, maxBuffer: Infinity });
        } catch {
          bzip2FallbackUsed = true;
          return Buffer.from(bzip2.decompressFile(buf));
        }
      default: return buf;
    }
  }

  _compress(buf) {
    switch (this.compression) {
      case "gz": return zlib.gzipSync(buf);
      case "bz2":
        try {
          return execFileSync(getBzip2Path(), ["-c"], { input: buf, maxBuffer: Infinity });
        } catch {
          bzip2FallbackUsed = true;
          return Buffer.from(bzip2.compressFile(buf));
        }
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
      if (onProgress && count % 500 === 0) {
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
      if (this.compression === "7z") {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await new Promise((resolve, reject) => {
          const proc = spawn(getSevenZipPath(), ["a", "-t7z", filePath, tempTar], { stdio: ["ignore", "pipe", "pipe"] });
          proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("7z compression failed")));
          proc.on("error", reject);
        });
      } else if (this.compression === "bz2") {
        const outFd = fs.openSync(filePath, "w");
        const ok = await new Promise((resolve, reject) => {
          const proc = spawn(getBzip2Path(), ["-k", "-c", tempTar], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => resolve(false));
        });
        if (!ok) {
          bzip2FallbackUsed = true;
          const tarBuf = fs.readFileSync(tempTar);
          fs.writeFileSync(filePath, Buffer.from(bzip2.compressFile(tarBuf)));
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
          const tarBuf = fs.readFileSync(tempTar);
          if (this.compression === "gz") {
            fs.writeFileSync(filePath, zlib.gzipSync(tarBuf));
          } else if (this.compression === "xz") {
            const compressed = await xzCompress(tarBuf);
            fs.writeFileSync(filePath, compressed);
          } else if (this.compression === "zst") {
            const { compress } = require("./zstd-compress");
            const compressed = await compress(tarBuf);
            fs.writeFileSync(filePath, compressed);
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
    const outPath = path.join(dest, entry.entryName);
    if (entry.isDirectory) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const data = this._getEntryData(entry);
      if (data) fs.writeFileSync(outPath, data);
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
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["l", "-slt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0) throw new Error("Failed to list 7z archive: " + (result.stderr || "unknown error"));
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
  }

  async save(filePath, onProgress) {
    const os = require("os");
    const { spawn } = require("child_process");
    const tempDir = path.join(os.tmpdir(), "archivesphynx-7z-" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    // Extract current archive to temp if we have a source
    if (this._filePath && fs.existsSync(this._filePath)) {
      await new Promise((resolve, reject) => {
        const proc = spawn(getSevenZipPath(), ["x", "-o" + tempDir, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("7z extraction failed")));
        proc.on("error", reject);
      });
    }
    // Apply pending additions (entries with _data)
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
    // Remove entries marked for deletion
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
    // Create new archive from temp dir
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await new Promise((resolve, reject) => {
      const proc = spawn(getSevenZipPath(), ["a", "-t7z", filePath, path.join(tempDir, "*")], { stdio: ["ignore", "pipe", "pipe"] });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("Failed to create 7z archive")));
      proc.on("error", reject);
    });
    // Clean up temp
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Re-read entries
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
    const { spawnSync } = require("child_process");
    this._cacheDir = path.join(os.tmpdir(), "archivesphynx-7zcache-" + Date.now());
    fs.mkdirSync(this._cacheDir, { recursive: true });
    spawnSync(getSevenZipPath(), ["x", "-o" + this._cacheDir, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
  }

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (entry._data) return entry._data;
    if (!this._filePath) return null;
    this._ensureCache();
    const cached = path.join(this._cacheDir, ...entryName.split("/"));
    try { return fs.readFileSync(cached); } catch { return null; }
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
      const buf = fs.readFileSync(innerPath);
      fs.writeFileSync(cpioPath, Buffer.from(fzstd.decompress(buf)));
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
    case "tar.7z": return new TarArchive("7z");
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

module.exports = { detectFormat, createArchive, setZstdPath, setBzip2Path, setGzipPath, setXzPath, setSevenZipPath, getSevenZipPath, setUnrarPath, isZstdAvailable, isZstdCliAvailable, wasBzip2FallbackUsed, ZipArchive, TarArchive, SevenZipArchive, RarArchive, JarArchive, DebArchive, RpmArchive, DmgArchive, IsoArchive };

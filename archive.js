const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const tar = require("tar-stream");
const unbzip2 = require("unbzip2-stream");
const bzip2 = require("compressjs").Bzip2;
const lzma = require("lzma-native");
const fzstd = require("fzstd");
const { execFileSync } = require("child_process");

let zstdPath = "zstd";
function getZstdPath() { return zstdPath; }
function setZstdPath(p) { if (p) zstdPath = p; }

function isZstdAvailable() {
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
    this.zip = null;
    this.format = "zip";
  }

  create() {
    this.zip = new AdmZip();
  }

  async open(filePath, onProgress) {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024 * 1024) {
      const sizeGB = (stat.size / (1024 * 1024 * 1024)).toFixed(1);
      throw new Error("File size (" + sizeGB + " GiB) exceeds the ZIP format limit of 2 GiB.\nUse a TAR-based format for larger archives.");
    }
    this.zip = new AdmZip(filePath);
    const count = this.zip.getEntries().length;
    if (onProgress) onProgress(count, count);
  }

  async save(filePath) {
    this.zip.getEntries().forEach((e) => { e.header.flags &= ~0x08; });
    this.zip.writeZip(filePath);
    await new Promise((r) => setTimeout(r, 0));
    this.zip = new AdmZip(filePath);
  }

  refresh() {
    // No-op — we use find-based getEntry instead of adm-zip's index
  }

  getEntries() {
    return this.zip.getEntries().map((e) => ({
      entryName: e.entryName,
      isDirectory: e.isDirectory,
      size: e.header?.size || 0,
      compressedSize: e.header?.compressedSize || 0,
      time: e.header?.time ? new Date(e.header.time) : null,
      method: e.header?.method === 8 ? "Deflate" : e.header?.method === 0 ? "Store" : String(e.header?.method || ""),
      attr: e.attr,
    }));
  }

  addFile(entryName, data) {
    this.zip.addFile(entryName, data);
  }

  deleteFile(entryName) {
    const entry = this.zip.getEntries().find((e) => e.entryName === entryName);
    if (entry) this.zip.deleteFile(entry);
  }

  renameEntry(oldPath, newPath) {
    const entries = this.zip.getEntries();
    if (oldPath.endsWith("/")) {
      entries.filter((e) => e.entryName.startsWith(oldPath))
        .forEach((e) => { e.entryName = newPath + e.entryName.slice(oldPath.length); });
    } else {
      const entry = entries.find((e) => e.entryName === oldPath);
      if (entry) entry.entryName = newPath;
    }
  }

  getEntry(entryName) {
    return this.zip.getEntries().find((e) => e.entryName === entryName) || null;
  }

  getData(entryName) {
    const entry = this.zip.getEntries().find((e) => e.entryName === entryName);
    if (!entry) return null;
    return entry.getData();
  }

  extractEntry(entryName, dest) {
    const entry = this.zip.getEntry(entryName);
    if (entry) this.zip.extractEntryTo(entry, dest, true, true);
  }

  extractAll(dest) {
    this.zip.extractAllTo(dest, true);
  }

  testIntegrity() {
    const errors = [];
    for (const entry of this.zip.getEntries()) {
      if (entry.isDirectory) continue;
      try {
        const data = entry.getData();
        if (!data) errors.push(entry.entryName + ": unable to read data");
      } catch (e) {
        errors.push(entry.entryName + ": " + e.message);
      }
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
      this._tempFile = path.join(os.tmpdir(), "archivesphinx-" + Date.now() + ".tar");
      if (this.compression === "7z") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        await new Promise((resolve, reject) => {
          const proc = spawn(getSevenZipPath(), ["e", "-so", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); code === 0 ? resolve() : reject(new Error("7z decompression failed")); });
          proc.on("error", (err) => { fs.closeSync(outFd); reject(err); });
        });
      } else if (this.compression === "gz") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        await new Promise((resolve, reject) => {
          const proc = spawn(getGzipPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); code === 0 ? resolve() : reject(new Error("gzip decompression failed")); });
          proc.on("error", (err) => { fs.closeSync(outFd); reject(err); });
        });
      } else if (this.compression === "bz2") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve, reject) => {
          const proc = spawn(getBzip2Path(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => { fs.closeSync(outFd); resolve(false); });
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
          proc.on("error", () => { fs.closeSync(outFd); resolve(false); });
        });
        if (!ok) {
          const buf = fs.readFileSync(filePath);
          const tarBuf = await new Promise((resolve, reject) => {
            lzma.decompress(buf, (result, err) => { if (err) reject(err); else resolve(result); });
          });
          fs.writeFileSync(this._tempFile, tarBuf);
        }
      } else if (this.compression === "zst") {
        const { spawn } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        const ok = await new Promise((resolve) => {
          const proc = spawn(getZstdPath(), ["-d", "-c", filePath], { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); resolve(code === 0); });
          proc.on("error", () => { fs.closeSync(outFd); resolve(false); });
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
      const tempTar = path.join(os.tmpdir(), "archivesphinx-pack-" + Date.now() + ".tar");
      await this._packTarToFile(tempTar, onProgress);
      await fs.promises.rename(tempTar, filePath).catch(async () => {
        await fs.promises.copyFile(tempTar, filePath);
        fs.unlinkSync(tempTar);
      });
    } else {
      // Compressed: pack to temp tar, then compress using CLI tools
      const tempTar = path.join(os.tmpdir(), "archivesphinx-pack-" + Date.now() + ".tar");
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
          proc.on("error", () => { fs.closeSync(outFd); resolve(false); });
        });
        if (!ok) {
          bzip2FallbackUsed = true;
          const tarBuf = fs.readFileSync(tempTar);
          fs.writeFileSync(filePath, Buffer.from(bzip2.compressFile(tarBuf)));
          fs.unlinkSync(tempTar);
          return;
        }
      } else {
        // gz, xz, zst — use async spawn to keep event loop alive
        let cmd, args;
        if (this.compression === "gz") { cmd = getGzipPath(); args = ["-c", tempTar]; }
        else if (this.compression === "xz") { cmd = getXzPath(); args = ["-c", tempTar]; }
        else if (this.compression === "zst") { cmd = getZstdPath(); args = ["-c", "--no-progress", "-3", tempTar]; }
        const outFd = fs.openSync(filePath, "w");
        await new Promise((resolve, reject) => {
          const proc = spawn(cmd, args, { stdio: ["ignore", outFd, "pipe"] });
          proc.on("close", (code) => { fs.closeSync(outFd); code === 0 ? resolve() : reject(new Error("Compression failed")); });
          proc.on("error", (err) => { fs.closeSync(outFd); reject(err); });
        });
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
    // Delegate to main process to avoid renderer event loop issues
    try {
      const { ipcRenderer } = require("electron");
      const os = require("os");
      const entriesFile = path.join(os.tmpdir(), "archivesphinx-entries-" + Date.now() + ".json");
      const entries = this.entries.map((e) => ({
        name: e.entryName,
        isDir: e.isDirectory,
        size: e.size || 0,
        offset: e.sourceFile ? e.offset : undefined,
        mtime: e.time ? e.time.toISOString() : null,
        mode: e.mode,
        linkname: e.linkname || undefined,
        type: e.type || undefined,
        data: (!e.isDirectory && e.data && !e.sourceFile) ? e.data.toString("base64") : undefined,
      }));
      fs.writeFileSync(entriesFile, JSON.stringify(entries));
      const srcFile = this._sourceFile || this.entries.find((e) => e.sourceFile)?.sourceFile || null;
      return ipcRenderer.invoke("tar-save", { srcFile, entriesFile, outFile: outPath }).then((offsets) => {
        // Update entries with new offsets pointing to the new file
        if (Array.isArray(offsets)) {
          for (let i = 0; i < this.entries.length && i < offsets.length; i++) {
            this.entries[i].sourceFile = this.entries[i].isDirectory ? null : outPath;
            this.entries[i].offset = offsets[i];
            this.entries[i].data = null;
          }
          this._sourceFile = outPath;
        }
      });
    } catch {
      // Fallback for non-renderer (Node CLI testing)
      return this._packTarToFileLocal(outPath, onProgress);
    }
  }

  _packTarToFileLocal(outPath, onProgress) {
    return new Promise((resolve, reject) => {
      const pack = tar.pack();
      const ws = fs.createWriteStream(outPath, { highWaterMark: 4 * 1024 * 1024 });
      pack.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
      pack.on("error", reject);
      const total = this.entries.length;
      let i = 0;
      const processBatch = () => {
        let count = 0;
        while (i < this.entries.length && count < 500) {
          const entry = this.entries[i++];
          if (entry.isDirectory) {
            pack.entry({ name: entry.entryName.replace(/\/$/, ""), type: "directory", mtime: entry.time, mode: entry.mode || 0o755 });
          } else if (entry.data) {
            pack.entry({ name: entry.entryName, size: entry.data.length, mtime: entry.time, mode: entry.mode || 0o644 }, entry.data);
          } else if (entry.sourceFile && entry.size > 0) {
            const fd = fs.openSync(entry.sourceFile, "r");
            const chunkBuf = Buffer.allocUnsafe(Math.min(entry.size, 1024 * 1024));
            let pos = entry.offset;
            const end = entry.offset + entry.size;
            if (entry.size <= chunkBuf.length) {
              fs.readSync(fd, chunkBuf, 0, entry.size, pos);
              fs.closeSync(fd);
              pack.entry({ name: entry.entryName, size: entry.size, mtime: entry.time, mode: entry.mode || 0o644 }, chunkBuf.slice(0, entry.size));
            } else {
              const entryStream = pack.entry({ name: entry.entryName, size: entry.size, mtime: entry.time, mode: entry.mode || 0o644 });
              while (pos < end) {
                const toRead = Math.min(chunkBuf.length, end - pos);
                fs.readSync(fd, chunkBuf, 0, toRead, pos);
                pos += toRead;
                entryStream.write(chunkBuf.slice(0, toRead));
              }
              fs.closeSync(fd);
              entryStream.end();
            }
          }
          count++;
          if (onProgress && i % 500 === 0) onProgress(i, total);
        }
        if (i >= this.entries.length) {
          if (onProgress) onProgress(total, total);
          pack.finalize();
        } else {
          setImmediate(processBatch);
        }
      };
      processBatch();
    });
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
    return null;
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
  }

  create() {
    this.entries = [];
    this._filePath = null;
  }

  async open(filePath, onProgress) {
    this._filePath = filePath;
    this.entries = [];
    const { spawnSync } = require("child_process");
    const result = spawnSync(getSevenZipPath(), ["l", "-slt", filePath], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    if (result.status !== 0) throw new Error("Failed to list 7z archive: " + (result.stderr || "unknown error"));
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = "));
    // First block is archive info; skip it
    for (let i = 1; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+";
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = parseInt(get("Packed Size"), 10) || 0;
      const mtime = get("Modified") ? new Date(get("Modified")) : null;
      const method = get("Method") || "LZMA2";
      this.entries.push({ entryName, isDirectory: isDir, size, compressedSize: compressed, time: mtime, method });
      if (onProgress) onProgress(i, blocks.length - 1);
    }
  }

  async save(filePath, onProgress) {
    const os = require("os");
    const { spawnSync } = require("child_process");
    const tempDir = path.join(os.tmpdir(), "archivesphinx-7z-" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    // Extract current archive to temp if we have a source
    if (this._filePath && fs.existsSync(this._filePath)) {
      spawnSync(getSevenZipPath(), ["x", "-o" + tempDir, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
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
    const result = spawnSync(getSevenZipPath(), ["a", "-t7z", filePath, path.join(tempDir, "*")], { stdio: ["ignore", "pipe", "pipe"] });
    // Clean up temp
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (result.status !== 0) throw new Error("Failed to create 7z archive");
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

  getData(entryName) {
    const entry = this.entries.find((e) => e.entryName === entryName);
    if (!entry || entry.isDirectory) return null;
    if (entry._data) return entry._data;
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
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = "));
    for (let i = 1; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+";
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = parseInt(get("Packed Size"), 10) || 0;
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
    if (result.status !== 0) throw new Error("Failed to list " + this.format + " archive: " + (result.stderr || "unknown error"));
    const blocks = result.stdout.split(/\n\n/).filter((b) => b.includes("Path = "));
    for (let i = 1; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      const get = (key) => { const l = lines.find((ln) => ln.startsWith(key + " = ")); return l ? l.slice(key.length + 3) : ""; };
      const entryPath = get("Path");
      if (!entryPath) continue;
      const isDir = get("Folder") === "+";
      const entryName = entryPath.replace(/\\/g, "/") + (isDir ? "/" : "");
      const size = parseInt(get("Size"), 10) || 0;
      const compressed = parseInt(get("Packed Size"), 10) || 0;
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

module.exports = { detectFormat, createArchive, setZstdPath, setBzip2Path, setGzipPath, setXzPath, setSevenZipPath, getSevenZipPath, setUnrarPath, isZstdAvailable, wasBzip2FallbackUsed, ZipArchive, TarArchive, SevenZipArchive, RarArchive, JarArchive, DebArchive, RpmArchive, DmgArchive, IsoArchive };

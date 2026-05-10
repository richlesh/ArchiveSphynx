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
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) return "tar.bz2";
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return "tar.xz";
  if (lower.endsWith(".tar.zst") || lower.endsWith(".tzst")) return "tar.zst";
  if (lower.endsWith(".tar.7z") || lower.endsWith(".t7z")) return "tar.7z";
  if (lower.endsWith(".tar")) return "tar";
  if (lower.endsWith(".7z")) return "7z";
  if (lower.endsWith(".rar")) return "rar";
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
        const { spawnSync } = require("child_process");
        const outFd = fs.openSync(this._tempFile, "w");
        spawnSync(getSevenZipPath(), ["e", "-so", filePath], { stdio: ["ignore", outFd, "pipe"] });
        fs.closeSync(outFd);
      } else {
        const buf = fs.readFileSync(filePath);
        let tarBuf;
        if (this.compression === "xz") {
          tarBuf = await new Promise((resolve, reject) => {
            lzma.decompress(buf, (result, err) => { if (err) reject(err); else resolve(result); });
          });
        } else if (this.compression === "zst") {
          tarBuf = Buffer.from(fzstd.decompress(buf));
        } else {
          tarBuf = this._decompress(buf);
        }
        fs.writeFileSync(this._tempFile, tarBuf);
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

  _parseOffsets(onProgress) {
    const sourceFile = this._sourceFile;
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      let count = 0;
      // Track position by accumulating consumed bytes
      let pos = 0;
      extract.on("entry", (header, stream, next) => {
        const entryName = header.name + (header.type === "directory" && !header.name.endsWith("/") ? "/" : "");
        const isDir = header.type === "directory";
        const dataSize = header.size || 0;
        // Consume stream to count actual bytes and find where data lives
        let dataBytes = 0;
        stream.on("data", (chunk) => { dataBytes += chunk.length; });
        stream.on("end", () => {
          // The data we just consumed is at (current file position - dataBytes) 
          // But we don't have exact file position. Use a different approach:
          // Store entry with null offset, then fix up after
          this.entries.push({
            entryName,
            isDirectory: isDir,
            size: dataSize,
            time: header.mtime || null,
            mode: header.mode || 0,
            data: null,
            sourceFile: isDir ? null : sourceFile,
            offset: 0, // will be fixed
            linkname: header.linkname || null,
            type: header.type || (isDir ? "directory" : "file"),
          });
          count++;
          if (onProgress) onProgress(count, 0);
          next();
        });
        stream.resume();
      });
      extract.on("finish", () => {
        // Fix offsets by scanning the file structure
        let filePos = 0;
        const fd = fs.openSync(sourceFile, "r");
        const hdrBuf = Buffer.alloc(512);
        let entryIdx = 0;
        while (entryIdx < this.entries.length) {
          fs.readSync(fd, hdrBuf, 0, 512, filePos);
          const name = hdrBuf.toString("utf8", 0, 100).replace(/\0.*/g, "");
          const type = String.fromCharCode(hdrBuf[156]);
          const hdrSize = parseInt(hdrBuf.toString("utf8", 124, 136).trim(), 8) || 0;
          const paddedSize = Math.ceil(hdrSize / 512) * 512;
          filePos += 512;
          if (type === "L" || type === "K") {
            // GNU long name/link — skip the data, next header is the real entry
            filePos += paddedSize;
            continue;
          }
          if (name === "" && hdrSize === 0) break; // end of archive
          // This is a real entry — assign offset
          if (entryIdx < this.entries.length) {
            this.entries[entryIdx].offset = filePos;
          }
          filePos += paddedSize;
          entryIdx++;
        }
        fs.closeSync(fd);
        if (onProgress) onProgress(count, count);
        resolve();
      });
      extract.on("error", reject);
      const rs = fs.createReadStream(sourceFile, { highWaterMark: 64 * 1024 });
      rs.on("error", reject);
      rs.pipe(extract);
    });
  }

  async save(filePath, onProgress) {
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
      await this._packTarToFile(tempTar, onProgress);
      const { spawnSync } = require("child_process");
      let outFd = fs.openSync(filePath, "w");
      let result;
      if (this.compression === "gz") {
        result = spawnSync(getGzipPath(), ["-c", tempTar], { stdio: ["ignore", outFd, "pipe"] });
      } else if (this.compression === "bz2") {
        result = spawnSync(getBzip2Path(), ["-k", "-c", tempTar], { stdio: ["ignore", outFd, "pipe"] });
        if (result.status !== 0) {
          bzip2FallbackUsed = true;
          fs.closeSync(outFd);
          const tarBuf = fs.readFileSync(tempTar);
          fs.writeFileSync(filePath, Buffer.from(bzip2.compressFile(tarBuf)));
          fs.unlinkSync(tempTar);
          return;
        }
      } else if (this.compression === "xz") {
        result = spawnSync(getXzPath(), ["-c", tempTar], { stdio: ["ignore", outFd, "pipe"] });
      } else if (this.compression === "zst") {
        result = spawnSync(getZstdPath(), ["-c", "--no-progress", "-3", tempTar], { stdio: ["ignore", outFd, "pipe"] });
      } else if (this.compression === "7z") {
        // 7z cannot stream to stdout; write directly to file
        fs.closeSync(outFd);
        outFd = null;
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        result = spawnSync(getSevenZipPath(), ["a", "-t7z", filePath, tempTar], { stdio: ["ignore", "pipe", "pipe"] });
      }
      if (outFd !== null) fs.closeSync(outFd);
      fs.unlinkSync(tempTar);
    }

    await new Promise((r) => setTimeout(r, 0));
    // Re-open with offsets
    if (this._tempFile) { try { fs.unlinkSync(this._tempFile); } catch {} }
    this._tempFile = null;
    if (this.compression === "none") {
      // Offsets already updated by _packTarToFile if using IPC path
      if (this._sourceFile !== filePath) {
        this._sourceFile = filePath;
        this.entries = [];
        return this._parseOffsets();
      }
      // else: already updated by the IPC handler's returned offsets
    } else {
      this._tempFile = path.join(os.tmpdir(), "archivesphinx-" + Date.now() + ".tar");
      // Decompress to temp for offset access
      if (this.compression === "7z") {
        const { spawnSync } = require("child_process");
        const outFd2 = fs.openSync(this._tempFile, "w");
        spawnSync(getSevenZipPath(), ["e", "-so", filePath], { stdio: ["ignore", outFd2, "pipe"] });
        fs.closeSync(outFd2);
      } else {
        const buf = fs.readFileSync(filePath);
        let tarBuf2;
        if (this.compression === "xz") {
          tarBuf2 = await new Promise((resolve, reject) => {
            lzma.decompress(buf, (result, err) => { if (err) reject(err); else resolve(result); });
          });
        } else if (this.compression === "zst") {
          tarBuf2 = Buffer.from(fzstd.decompress(buf));
        } else {
          tarBuf2 = this._decompress(buf);
        }
        fs.writeFileSync(this._tempFile, tarBuf2);
      }
      this._sourceFile = this._tempFile;
      this.entries = [];
      return this._parseOffsets();
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

  extractAll(dest) {
    for (const entry of this.entries) {
      this.extractEntry(entry.entryName, dest);
    }
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

  extractAll(dest) {
    if (!this._filePath) return;
    const { spawnSync } = require("child_process");
    spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
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

  extractAll(dest) {
    if (!this._filePath) return;
    const { spawnSync } = require("child_process");
    let result = spawnSync(getSevenZipPath(), ["x", "-o" + dest, "-y", this._filePath], { stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) {
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
    default: return null;
  }
}

function openArchive(filePath) {
  const archive = createArchive(filePath);
  if (!archive) return null;
  return archive;
}

module.exports = { detectFormat, createArchive, setZstdPath, setBzip2Path, setGzipPath, setXzPath, setSevenZipPath, setUnrarPath, isZstdAvailable, wasBzip2FallbackUsed, ZipArchive, TarArchive, SevenZipArchive, RarArchive };

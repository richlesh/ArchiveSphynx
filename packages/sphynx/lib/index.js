const path = require("path");

let wasmModule = null;

const FORMAT = { ZIP: 0, TAR: 1, SEVENZIP: 2 };
const FILTER = { NONE: 0, GZIP: 1, BZIP2: 2, XZ: 3, ZSTD: 4 };

async function init() {
  if (wasmModule) return wasmModule;
  const createSphynx = require("./sphynx.js");
  wasmModule = await createSphynx();
  return wasmModule;
}

class ArchiveReader {
  constructor(mod, ptr) {
    this._mod = mod;
    this._ptr = ptr;
    this._buf = null;
  }

  static async open(data) {
    const mod = await init();
    const ptr = mod._reader_new();
    const buf = mod._malloc(data.length);
    mod.HEAPU8.set(data, buf);
    const r = mod._reader_open_memory(ptr, buf, data.length);
    if (r !== 0) {
      mod._free(buf);
      mod._reader_close(ptr);
      throw new Error("Failed to open archive");
    }
    const reader = new ArchiveReader(mod, ptr);
    reader._buf = buf;
    return reader;
  }

  next() {
    const r = this._mod._reader_next(this._ptr);
    if (r !== 0) return null; // ARCHIVE_EOF or error
    return {
      pathname: this._mod.UTF8ToString(this._mod._entry_pathname()),
      isDirectory: !!this._mod._entry_is_dir(),
      size: this._mod._entry_size(),
      mtime: this._mod._entry_mtime(),
      perm: this._mod._entry_perm(),
      isSymlink: !!this._mod._entry_is_symlink(),
      symlink: this._mod.UTF8ToString(this._mod._entry_symlink()),
    };
  }

  readData(maxSize) {
    maxSize = maxSize || 65536;
    const buf = this._mod._malloc(maxSize);
    const n = this._mod._reader_read_data(this._ptr, buf, maxSize);
    if (n <= 0) { this._mod._free(buf); return null; }
    const result = Buffer.from(this._mod.HEAPU8.slice(buf, buf + n));
    this._mod._free(buf);
    return result;
  }

  readAll() {
    const chunks = [];
    let chunk;
    while ((chunk = this.readData(262144)) !== null) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  close() {
    if (this._buf) { this._mod._free(this._buf); this._buf = null; }
    this._mod._reader_close(this._ptr);
    this._ptr = null;
  }

  *[Symbol.iterator]() {
    let entry;
    while ((entry = this.next()) !== null) {
      yield entry;
    }
  }
}

class ArchiveWriter {
  constructor(mod, ptr) {
    this._mod = mod;
    this._ptr = ptr;
  }

  static async create(format, filter) {
    const mod = await init();
    const fmt = FORMAT[format] !== undefined ? FORMAT[format] : format;
    const flt = FILTER[filter] !== undefined ? FILTER[filter] : filter;
    const ptr = mod._writer_new(fmt, flt);
    const r = mod._writer_open_memory(ptr);
    if (r !== 0) {
      mod._writer_close(ptr);
      throw new Error("Failed to create archive writer");
    }
    return new ArchiveWriter(mod, ptr);
  }

  addFile(pathname, data, options = {}) {
    const mtime = options.mtime || Math.floor(Date.now() / 1000);
    const perm = options.perm || 0o644;
    const r = this._mod.ccall("writer_add_entry", "number",
      ["number", "string", "number", "number", "number", "number"],
      [this._ptr, pathname, 0, data.length, mtime, perm]);
    if (r !== 0) throw new Error("Failed to add entry header");
    const buf = this._mod._malloc(data.length);
    this._mod.HEAPU8.set(data, buf);
    this._mod._writer_write_data(this._ptr, buf, data.length);
    this._mod._free(buf);
  }

  addDirectory(pathname, options = {}) {
    const mtime = options.mtime || Math.floor(Date.now() / 1000);
    const perm = options.perm || 0o755;
    this._mod.ccall("writer_add_entry", "number",
      ["number", "string", "number", "number", "number", "number"],
      [this._ptr, pathname, 1, 0, mtime, perm]);
  }

  finish() {
    this._mod._writer_close(this._ptr);
    const ptr = this._mod._writer_get_buffer();
    const size = this._mod._writer_get_size();
    const result = Buffer.from(this._mod.HEAPU8.slice(ptr, ptr + size));
    this._mod._writer_free_buffer();
    this._ptr = null;
    return result;
  }
}

class StreamingReader {
  constructor(mod, ptr, readFnPtr, fd) {
    this._mod = mod;
    this._ptr = ptr;
    this._readFnPtr = readFnPtr;
    this._fd = fd;
  }

  static async openFile(filePath) {
    const fs = require("fs");
    const mod = await init();
    const fd = fs.openSync(filePath, "r");
    const chunkSize = 262144;
    const jsBuf = Buffer.alloc(chunkSize);

    const readFnPtr = mod.addFunction((bufPtr, size) => {
      const n = fs.readSync(fd, jsBuf, 0, size, null);
      if (n > 0) mod.HEAPU8.set(jsBuf.subarray(0, n), bufPtr);
      return n;
    }, "iii");

    const ptr = mod._reader_new();
    const r = mod._reader_open_streaming(ptr, readFnPtr);
    if (r !== 0) {
      mod.removeFunction(readFnPtr);
      fs.closeSync(fd);
      mod._reader_close(ptr);
      throw new Error("Failed to open streaming archive");
    }
    return new StreamingReader(mod, ptr, readFnPtr, fd);
  }

  next() {
    const r = this._mod._reader_next(this._ptr);
    if (r !== 0) return null;
    return {
      pathname: this._mod.UTF8ToString(this._mod._entry_pathname()),
      isDirectory: !!this._mod._entry_is_dir(),
      size: this._mod._entry_size(),
      mtime: this._mod._entry_mtime(),
      perm: this._mod._entry_perm(),
      isSymlink: !!this._mod._entry_is_symlink(),
      symlink: this._mod.UTF8ToString(this._mod._entry_symlink()),
    };
  }

  readData(maxSize) {
    maxSize = maxSize || 262144;
    const buf = this._mod._malloc(maxSize);
    const n = this._mod._reader_read_data(this._ptr, buf, maxSize);
    if (n <= 0) { this._mod._free(buf); return null; }
    const result = Buffer.from(this._mod.HEAPU8.slice(buf, buf + n));
    this._mod._free(buf);
    return result;
  }

  extractTo(outPath) {
    const fs = require("fs");
    const pathMod = require("path");
    const ws = fs.createWriteStream(pathMod.resolve(outPath));
    let chunk;
    while ((chunk = this.readData()) !== null) {
      ws.write(chunk);
    }
    ws.end();
  }

  close() {
    const fs = require("fs");
    this._mod._reader_close(this._ptr);
    this._mod.removeFunction(this._readFnPtr);
    fs.closeSync(this._fd);
    this._ptr = null;
  }

  *[Symbol.iterator]() {
    let entry;
    while ((entry = this.next()) !== null) {
      yield entry;
    }
  }
}

class StreamingWriter {
  constructor(mod, ptr, writeFnPtr, fd) {
    this._mod = mod;
    this._ptr = ptr;
    this._writeFnPtr = writeFnPtr;
    this._fd = fd;
  }

  static async createFile(filePath, format, filter) {
    const fs = require("fs");
    const mod = await init();
    const fd = fs.openSync(filePath, "w");

    const writeFnPtr = mod.addFunction((bufPtr, size) => {
      const data = Buffer.from(mod.HEAPU8.buffer, bufPtr, size);
      fs.writeSync(fd, data);
      return size;
    }, "iii");

    const fmt = FORMAT[format] !== undefined ? FORMAT[format] : format;
    const flt = FILTER[filter] !== undefined ? FILTER[filter] : filter;
    const ptr = mod._writer_new(fmt, flt);
    const r = mod._writer_open_streaming(ptr, writeFnPtr);
    if (r !== 0) {
      mod.removeFunction(writeFnPtr);
      fs.closeSync(fd);
      mod._writer_close(ptr);
      throw new Error("Failed to create streaming archive writer");
    }
    return new StreamingWriter(mod, ptr, writeFnPtr, fd);
  }

  addFile(pathname, data, options = {}) {
    const mtime = options.mtime || Math.floor(Date.now() / 1000);
    const perm = options.perm || 0o644;
    this._mod.ccall("writer_add_entry", "number",
      ["number", "string", "number", "number", "number", "number"],
      [this._ptr, pathname, 0, data.length, mtime, perm]);
    const buf = this._mod._malloc(data.length);
    this._mod.HEAPU8.set(data, buf);
    this._mod._writer_write_data(this._ptr, buf, data.length);
    this._mod._free(buf);
  }

  addFileFromPath(pathname, filePath, options = {}) {
    const fs = require("fs");
    const stat = fs.statSync(filePath);
    const mtime = options.mtime || Math.floor(stat.mtimeMs / 1000);
    const perm = options.perm || (stat.mode & 0o777);
    this._mod.ccall("writer_add_entry", "number",
      ["number", "string", "number", "number", "number", "number"],
      [this._ptr, pathname, 0, stat.size, mtime, perm]);
    const chunkSize = 262144;
    const fd = fs.openSync(filePath, "r");
    const jsBuf = Buffer.alloc(chunkSize);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, jsBuf, 0, chunkSize, null)) > 0) {
      const buf = this._mod._malloc(bytesRead);
      this._mod.HEAPU8.set(jsBuf.subarray(0, bytesRead), buf);
      this._mod._writer_write_data(this._ptr, buf, bytesRead);
      this._mod._free(buf);
    }
    fs.closeSync(fd);
  }

  addDirectory(pathname, options = {}) {
    const mtime = options.mtime || Math.floor(Date.now() / 1000);
    const perm = options.perm || 0o755;
    this._mod.ccall("writer_add_entry", "number",
      ["number", "string", "number", "number", "number", "number"],
      [this._ptr, pathname, 1, 0, mtime, perm]);
  }

  finish() {
    const fs = require("fs");
    this._mod._writer_close(this._ptr);
    this._mod.removeFunction(this._writeFnPtr);
    fs.closeSync(this._fd);
    this._ptr = null;
  }
}

module.exports = { init, ArchiveReader, ArchiveWriter, StreamingReader, StreamingWriter, FORMAT, FILTER };

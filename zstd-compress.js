// CJS wrapper for zstdify (ESM-only package)
let _mod = null;
module.exports.compress = async function (buf) {
  if (!_mod) _mod = await import("zstdify");
  return _mod.compress(buf);
};

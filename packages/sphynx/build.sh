#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
DEPS_DIR="$BUILD_DIR/deps"
INSTALL_DIR="$BUILD_DIR/install"

mkdir -p "$BUILD_DIR" "$DEPS_DIR" "$INSTALL_DIR"

# Versions
ZLIB_VER=1.3.1
XZ_VER=5.6.4
ZSTD_VER=1.5.6
BZIP2_VER=1.0.8
LIBARCHIVE_VER=3.7.7

export CFLAGS="-O2"
export CXXFLAGS="-O2"

# ─── Download dependencies ───

cd "$DEPS_DIR"

if [ ! -d "zlib-$ZLIB_VER" ]; then
  echo "Downloading zlib..."
  curl -sL "https://github.com/madler/zlib/releases/download/v$ZLIB_VER/zlib-$ZLIB_VER.tar.gz" | tar xz
fi

if [ ! -d "xz-$XZ_VER" ]; then
  echo "Downloading xz/liblzma..."
  curl -sL "https://github.com/tukaani-project/xz/releases/download/v$XZ_VER/xz-$XZ_VER.tar.gz" | tar xz
fi

if [ ! -d "zstd-$ZSTD_VER" ]; then
  echo "Downloading zstd..."
  curl -sL "https://github.com/facebook/zstd/releases/download/v$ZSTD_VER/zstd-$ZSTD_VER.tar.gz" | tar xz
fi

if [ ! -d "bzip2-$BZIP2_VER" ]; then
  echo "Downloading bzip2..."
  curl -sL "https://sourceware.org/pub/bzip2/bzip2-$BZIP2_VER.tar.gz" | tar xz
fi

if [ ! -d "libarchive-$LIBARCHIVE_VER" ]; then
  echo "Downloading libarchive..."
  curl -sL "https://github.com/libarchive/libarchive/releases/download/v$LIBARCHIVE_VER/libarchive-$LIBARCHIVE_VER.tar.gz" | tar xz
fi

# ─── Build zlib ───

if [ ! -f "$INSTALL_DIR/lib/libz.a" ]; then
  echo "Building zlib..."
  cd "$DEPS_DIR/zlib-$ZLIB_VER"
  emcmake cmake -B build -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" -DBUILD_SHARED_LIBS=OFF
  cmake --build build -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
  cmake --install build
fi

# ─── Build liblzma ───

if [ ! -f "$INSTALL_DIR/lib/liblzma.a" ]; then
  echo "Building liblzma..."
  cd "$DEPS_DIR/xz-$XZ_VER"
  emcmake cmake -B build -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DBUILD_SHARED_LIBS=OFF -DENABLE_THREADS=OFF -DENABLE_SMALL=ON
  cmake --build build --target liblzma -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
  cmake --install build --component liblzma_Development 2>/dev/null || cmake --install build
fi

# ─── Build zstd ───

if [ ! -f "$INSTALL_DIR/lib/libzstd.a" ]; then
  echo "Building zstd..."
  cd "$DEPS_DIR/zstd-$ZSTD_VER/build/cmake"
  emcmake cmake -B build -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DBUILD_SHARED_LIBS=OFF -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF \
    -DZSTD_MULTITHREAD_SUPPORT=OFF
  cmake --build build -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
  cmake --install build
fi

# ─── Build bzip2 ───

if [ ! -f "$INSTALL_DIR/lib/libbz2.a" ]; then
  echo "Building bzip2..."
  cd "$DEPS_DIR/bzip2-$BZIP2_VER"
  emcc $CFLAGS -c blocksort.c huffman.c crctable.c randtable.c compress.c decompress.c bzlib.c
  emar rcs libbz2.a blocksort.o huffman.o crctable.o randtable.o compress.o decompress.o bzlib.o
  cp libbz2.a "$INSTALL_DIR/lib/"
  cp bzlib.h "$INSTALL_DIR/include/"
fi

# ─── Build libarchive ───

if [ ! -f "$INSTALL_DIR/lib/libarchive.a" ]; then
  echo "Building libarchive..."
  cd "$DEPS_DIR/libarchive-$LIBARCHIVE_VER"
  emcmake cmake -B build -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DCMAKE_FIND_ROOT_PATH="$INSTALL_DIR" \
    -DZLIB_LIBRARY="$INSTALL_DIR/lib/libz.a" -DZLIB_INCLUDE_DIR="$INSTALL_DIR/include" \
    -DLIBLZMA_LIBRARY="$INSTALL_DIR/lib/liblzma.a" -DLIBLZMA_INCLUDE_DIR="$INSTALL_DIR/include" \
    -DZSTD_LIBRARY="$INSTALL_DIR/lib/libzstd.a" -DZSTD_INCLUDE_DIR="$INSTALL_DIR/include" \
    -DBZIP2_LIBRARIES="$INSTALL_DIR/lib/libbz2.a" -DBZIP2_INCLUDE_DIR="$INSTALL_DIR/include" \
    -DBUILD_SHARED_LIBS=OFF -DENABLE_TEST=OFF -DENABLE_CAT=OFF -DENABLE_CPIO=OFF -DENABLE_TAR=OFF \
    -DENABLE_OPENSSL=OFF -DENABLE_LIBXML2=OFF -DENABLE_EXPAT=OFF -DENABLE_ACL=OFF
  cmake --build build -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
  cmake --install build
fi

# ─── Compile WASM module ───

echo "Compiling sphynx WASM module..."
cd "$SCRIPT_DIR"

emcc -O2 \
  src/sphynx.c \
  -I"$INSTALL_DIR/include" \
  -L"$INSTALL_DIR/lib" \
  -larchive -lz -llzma -lzstd -lbz2 \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ALLOW_TABLE_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","UTF8ToString","addFunction","removeFunction","HEAPU8"]' \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createSphynx" \
  -s ENVIRONMENT='node' \
  -s NODERAWFS=1 \
  -s TOTAL_MEMORY=16MB \
  -o lib/sphynx.js

echo "Build complete: lib/sphynx.js + lib/sphynx.wasm"

#include <archive.h>
#include <archive_entry.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

// ─── Reader API ───

EMSCRIPTEN_KEEPALIVE
struct archive *reader_new(void) {
  struct archive *a = archive_read_new();
  archive_read_support_format_all(a);
  archive_read_support_filter_all(a);
  return a;
}

EMSCRIPTEN_KEEPALIVE
int reader_open_memory(struct archive *a, const void *buf, size_t size) {
  return archive_read_open_memory(a, buf, size);
}

EMSCRIPTEN_KEEPALIVE
int reader_next_header(struct archive *a) {
  struct archive_entry *entry;
  int r = archive_read_next_header(a, &entry);
  return r;
}

EMSCRIPTEN_KEEPALIVE
const char *reader_entry_pathname(struct archive *a) {
  struct archive_entry *entry;
  // Re-read current header to get entry pointer
  // Actually, libarchive keeps the current entry internally
  // We need a different approach - store entry pointer
  return NULL; // placeholder
}

EMSCRIPTEN_KEEPALIVE
int reader_close(struct archive *a) {
  archive_read_close(a);
  return archive_read_free(a);
}

// ─── Better approach: store current entry ───

static struct archive_entry *current_entry = NULL;

EMSCRIPTEN_KEEPALIVE
int reader_next(struct archive *a) {
  int r = archive_read_next_header(a, &current_entry);
  return r;
}

EMSCRIPTEN_KEEPALIVE
const char *entry_pathname(void) {
  if (!current_entry) return "";
  return archive_entry_pathname(current_entry);
}

EMSCRIPTEN_KEEPALIVE
int entry_is_dir(void) {
  if (!current_entry) return 0;
  return archive_entry_filetype(current_entry) == AE_IFDIR;
}

EMSCRIPTEN_KEEPALIVE
int64_t entry_size(void) {
  if (!current_entry) return 0;
  return archive_entry_size(current_entry);
}

EMSCRIPTEN_KEEPALIVE
int64_t entry_mtime(void) {
  if (!current_entry) return 0;
  return archive_entry_mtime(current_entry);
}

EMSCRIPTEN_KEEPALIVE
int entry_perm(void) {
  if (!current_entry) return 0;
  return archive_entry_perm(current_entry);
}

EMSCRIPTEN_KEEPALIVE
int entry_is_symlink(void) {
  if (!current_entry) return 0;
  return archive_entry_filetype(current_entry) == AE_IFLNK;
}

EMSCRIPTEN_KEEPALIVE
const char *entry_symlink(void) {
  if (!current_entry) return "";
  const char *s = archive_entry_symlink(current_entry);
  return s ? s : "";
}

EMSCRIPTEN_KEEPALIVE
int reader_read_data(struct archive *a, void *buf, size_t size) {
  la_ssize_t n = archive_read_data(a, buf, size);
  return (int)n;
}

// ─── Writer API ───

EMSCRIPTEN_KEEPALIVE
struct archive *writer_new(int format, int filter) {
  struct archive *a = archive_write_new();
  switch (format) {
    case 0: archive_write_set_format_zip(a); break;
    case 1: archive_write_set_format_pax_restricted(a); break;  // TAR
    case 2: archive_write_set_format_7zip(a); break;
    default: archive_write_set_format_zip(a); break;
  }
  switch (filter) {
    case 0: archive_write_add_filter_none(a); break;
    case 1: archive_write_add_filter_gzip(a); break;
    case 2: archive_write_add_filter_bzip2(a); break;
    case 3: archive_write_add_filter_xz(a); break;
    case 4: archive_write_add_filter_zstd(a); break;
    default: archive_write_add_filter_none(a); break;
  }
  return a;
}

static void *write_buf = NULL;
static size_t write_buf_size = 0;
static size_t write_buf_used = 0;

static int write_open_cb(struct archive *a, void *data) {
  write_buf_size = 1024 * 1024;
  write_buf = malloc(write_buf_size);
  write_buf_used = 0;
  return ARCHIVE_OK;
}

static la_ssize_t write_write_cb(struct archive *a, void *data, const void *buf, size_t len) {
  while (write_buf_used + len > write_buf_size) {
    write_buf_size *= 2;
    write_buf = realloc(write_buf, write_buf_size);
  }
  memcpy((char *)write_buf + write_buf_used, buf, len);
  write_buf_used += len;
  return (la_ssize_t)len;
}

static int write_close_cb(struct archive *a, void *data) {
  return ARCHIVE_OK;
}

EMSCRIPTEN_KEEPALIVE
int writer_open_memory(struct archive *a) {
  return archive_write_open(a, NULL, write_open_cb, write_write_cb, write_close_cb);
}

EMSCRIPTEN_KEEPALIVE
int writer_add_entry(struct archive *a, const char *pathname, int is_dir,
                     int64_t size, int64_t mtime, int perm) {
  struct archive_entry *entry = archive_entry_new();
  archive_entry_set_pathname(entry, pathname);
  archive_entry_set_size(entry, is_dir ? 0 : size);
  archive_entry_set_filetype(entry, is_dir ? AE_IFDIR : AE_IFREG);
  archive_entry_set_perm(entry, perm ? perm : (is_dir ? 0755 : 0644));
  archive_entry_set_mtime(entry, mtime, 0);
  int r = archive_write_header(a, entry);
  archive_entry_free(entry);
  return r;
}

EMSCRIPTEN_KEEPALIVE
int writer_write_data(struct archive *a, const void *buf, size_t size) {
  la_ssize_t n = archive_write_data(a, buf, size);
  return (int)n;
}

EMSCRIPTEN_KEEPALIVE
int writer_close(struct archive *a) {
  archive_write_close(a);
  return archive_write_free(a);
}

EMSCRIPTEN_KEEPALIVE
void *writer_get_buffer(void) {
  return write_buf;
}

EMSCRIPTEN_KEEPALIVE
size_t writer_get_size(void) {
  return write_buf_used;
}

EMSCRIPTEN_KEEPALIVE
void writer_free_buffer(void) {
  if (write_buf) { free(write_buf); write_buf = NULL; }
  write_buf_size = 0;
  write_buf_used = 0;
}

// ─── Streaming Reader API ───
// JS provides a read callback: int read_cb(void *buf, int size)
// Returns bytes read, 0 for EOF, <0 for error.

typedef int (*js_read_fn)(void *buf, int size);
typedef int (*js_write_fn)(const void *buf, int size);

static js_read_fn stream_read_cb = NULL;
static void *stream_read_buf = NULL;
static size_t stream_read_buf_size = 0;

static la_ssize_t streaming_read_cb(struct archive *a, void *data, const void **out_buf) {
  if (!stream_read_cb) return -1;
  if (!stream_read_buf) {
    stream_read_buf_size = 262144;
    stream_read_buf = malloc(stream_read_buf_size);
  }
  int n = stream_read_cb(stream_read_buf, (int)stream_read_buf_size);
  if (n < 0) return ARCHIVE_FATAL;
  *out_buf = stream_read_buf;
  return (la_ssize_t)n;
}

static int streaming_read_close_cb(struct archive *a, void *data) {
  if (stream_read_buf) { free(stream_read_buf); stream_read_buf = NULL; }
  stream_read_cb = NULL;
  return ARCHIVE_OK;
}

EMSCRIPTEN_KEEPALIVE
int reader_open_streaming(struct archive *a, js_read_fn read_fn) {
  stream_read_cb = read_fn;
  return archive_read_open(a, NULL, NULL, streaming_read_cb, streaming_read_close_cb);
}

// ─── Streaming Writer API ───
// JS provides a write callback: int write_cb(const void *buf, int size)
// Returns bytes written or <0 for error.

static js_write_fn stream_write_cb = NULL;

static la_ssize_t streaming_write_cb(struct archive *a, void *data, const void *buf, size_t len) {
  if (!stream_write_cb) return -1;
  int n = stream_write_cb(buf, (int)len);
  return (la_ssize_t)n;
}

static int streaming_write_close_cb(struct archive *a, void *data) {
  stream_write_cb = NULL;
  return ARCHIVE_OK;
}

EMSCRIPTEN_KEEPALIVE
int writer_open_streaming(struct archive *a, js_write_fn write_fn) {
  stream_write_cb = write_fn;
  return archive_write_open(a, NULL, NULL, streaming_write_cb, streaming_write_close_cb);
}

// ─── Error handling ───

EMSCRIPTEN_KEEPALIVE
const char *get_error(struct archive *a) {
  const char *e = archive_error_string(a);
  return e ? e : "";
}

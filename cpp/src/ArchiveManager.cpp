#include "ArchiveManager.h"

#include <QFileInfo>
#include <QDir>
#include <archive.h>
#include <archive_entry.h>

ArchiveManager::ArchiveManager(QObject *parent) : QObject(parent) {}

bool ArchiveManager::open(const QString &filePath) {
  close();

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  if (archive_read_open_filename(a, filePath.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_read_free(a);
    return false;
  }

  m_currentFile = filePath;
  QFileInfo fi(filePath);
  QString ext = fi.suffix().toLower();
  m_readOnly = (ext == "rar" || ext == "deb" || ext == "rpm" || ext == "dmg" || ext == "iso");

  bool isZipLike = (ext == "zip" || ext == "7z" || ext == "jar");

  struct archive_entry *entry;
  while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    ArchiveEntry e;
    e.path = QString::fromUtf8(archive_entry_pathname(entry));
    e.size = archive_entry_size(entry);
    e.compressedSize = 0;
    e.isDirectory = (archive_entry_filetype(entry) == AE_IFDIR);
    e.isSymlink = (archive_entry_filetype(entry) == AE_IFLNK) || (archive_entry_symlink(entry) != nullptr);
    e.modified = QDateTime::fromSecsSinceEpoch(archive_entry_mtime(entry));
    mode_t mode = archive_entry_perm(entry);
    e.permissions = QString::asprintf("%o", mode);

    if (isZipLike) {
      // Get compression method from the current filter
      const char *filter = archive_filter_name(a, 0);
      e.compressionMethod = filter ? QString::fromUtf8(filter) : tr("Stored");
      if (e.compressionMethod == "none") e.compressionMethod = tr("Stored");

      // Calculate compressed size by reading data blocks
      if (!e.isDirectory) {
        const void *buff;
        size_t len;
        la_int64_t offset;
        qint64 total = 0;
        while (archive_read_data_block(a, &buff, &len, &offset) == ARCHIVE_OK)
          total += len;
        // For zip, the raw compressed size isn't directly available via streaming;
        // use the position delta from the archive as an approximation
        e.compressedSize = total > 0 ? total : e.size;
      }
    } else {
      e.compressionMethod = QString();
      e.compressedSize = 0;
      archive_read_data_skip(a);
    }

    m_entries.append(e);
  }

  archive_read_free(a);
  emit archiveOpened(filePath);
  return true;
}

void ArchiveManager::close() {
  m_currentFile.clear();
  m_entries.clear();
  m_readOnly = false;
}

QString ArchiveManager::currentFile() const { return m_currentFile; }
QList<ArchiveEntry> ArchiveManager::entries() const { return m_entries; }
bool ArchiveManager::isReadOnly() const { return m_readOnly; }

bool ArchiveManager::extractTo(const QString &destDir) {
  if (m_currentFile.isEmpty()) return false;

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  struct archive *ext = archive_write_disk_new();
  archive_write_disk_set_options(ext, ARCHIVE_EXTRACT_TIME | ARCHIVE_EXTRACT_PERM);
  archive_write_disk_set_standard_lookup(ext);

  if (archive_read_open_filename(a, m_currentFile.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_read_free(a);
    archive_write_free(ext);
    return false;
  }

  int total = m_entries.size();
  int current = 0;

  struct archive_entry *entry;
  while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    QString entryPath = destDir + "/" + QString::fromUtf8(archive_entry_pathname(entry));
    archive_entry_set_pathname(entry, entryPath.toUtf8().constData());

    if (archive_write_header(ext, entry) != ARCHIVE_OK) continue;

    if (archive_entry_size(entry) > 0) {
      const void *buff;
      size_t size;
      la_int64_t offset;
      while (archive_read_data_block(a, &buff, &size, &offset) == ARCHIVE_OK)
        archive_write_data_block(ext, buff, size, offset);
    }
    archive_write_finish_entry(ext);

    current++;
    if (total > 0)
      emit progressChanged(current * 100 / total);
  }

  archive_read_free(a);
  archive_write_free(ext);
  return true;
}

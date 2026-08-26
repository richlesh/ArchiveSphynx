// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "ArchiveManager.h"

#include <QFileInfo>
#include <QDir>
#include <QFile>
#include <QHash>
#include <QSet>
#include <QDirIterator>
#include <archive.h>
#include <archive_entry.h>

#ifdef Q_OS_MACOS
#include <sys/stat.h>
#include <sys/xattr.h>
#endif

ArchiveManager::ArchiveManager(QObject *parent) : QObject(parent) {}

bool ArchiveManager::open(const QString &filePath) {
  close();

  QFileInfo fi(filePath);
  QString ext = fi.suffix().toLower();

  // For standalone compressed file extensions, check if there's an archive inside.
  // If not, handle as raw compressed.
  bool isCompressedExt = (ext == "xz" || ext == "gz" || ext == "bz2" || ext == "zst" || ext == "lz4" || ext == "lzma");

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);
  archive_read_set_format_option(a, "zip", "mac-ext", NULL);

  if (archive_read_open_filename(a, filePath.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    archive_read_free(a);
    // If it's a compressed extension, try as raw
    if (isCompressedExt)
      return openRawCompressed(filePath);
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    return false;
  }

  m_currentFile = filePath;
  m_readOnly = (ext == "rar" || ext == "deb" || ext == "rpm" || ext == "dmg" || ext == "iso");

  bool isZipLike = (ext == "zip" || ext == "7z" || ext == "jar");

  struct archive_entry *entry;
  int readCount = 0;
  bool gotHeader = false;
  while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    gotHeader = true;
    if (++readCount % 50 == 0) emit progressChanged(-1);
    ArchiveEntry e;
    e.path = QString::fromUtf8(archive_entry_pathname(entry));
    e.size = archive_entry_size(entry);
    e.compressedSize = 0;
    e.isDirectory = (archive_entry_filetype(entry) == AE_IFDIR);
    e.isSymlink = (archive_entry_filetype(entry) == AE_IFLNK) || (archive_entry_symlink(entry) != nullptr);
    e.modified = QDateTime::fromSecsSinceEpoch(archive_entry_mtime(entry));
    unsigned int mode = archive_entry_perm(entry);
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

  // If no headers were found and it's a compressed extension, try as raw compressed
  if (!gotHeader && isCompressedExt) {
    return openRawCompressed(filePath);
  }

  emit archiveOpened(filePath);
  return true;
}

bool ArchiveManager::openRawCompressed(const QString &filePath) {
  // Reset state since open() may have partially initialized
  m_entries.clear();
  m_currentFile.clear();
  m_readOnly = false;

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_raw(a);

  if (archive_read_open_filename(a, filePath.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_read_free(a);
    return false;
  }

  struct archive_entry *entry;
  if (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    QFileInfo fi(filePath);
    // Derive the inner filename by stripping the compression extension
    QString innerName = fi.completeBaseName(); // e.g. "img.xz" -> "img"

    ArchiveEntry e;
    e.path = innerName;
    e.size = archive_entry_size_is_set(entry) ? archive_entry_size(entry) : 0;
    e.compressedSize = fi.size();
    e.isDirectory = false;
    e.isSymlink = false;
    e.modified = fi.lastModified();
    e.permissions = QStringLiteral("644");
    e.compressionMethod = QString::fromUtf8(archive_filter_name(a, 0));
    m_entries.append(e);
  }

  archive_read_free(a);

  if (m_entries.isEmpty()) {
    emit errorOccurred(tr("Failed to read compressed file."));
    return false;
  }

  m_currentFile = filePath;
  m_readOnly = true;
  emit archiveOpened(filePath);
  return true;
}

void ArchiveManager::close() {
  m_currentFile.clear();
  m_entries.clear();
  m_readOnly = false;
}

QString ArchiveManager::currentFile() const { return m_currentFile; }
void ArchiveManager::setCurrentFile(const QString &filePath) { m_currentFile = filePath; }
QList<ArchiveEntry> ArchiveManager::entries() const { return m_entries; }
bool ArchiveManager::isReadOnly() const { return m_readOnly; }

bool ArchiveManager::extractRawCompressed(const QString &destDir, OverwriteCallback overwriteCallback) {
  QFileInfo fi(m_currentFile);
  QString innerName = fi.completeBaseName();
  QString destPath = destDir + "/" + innerName;

  // Check for overwrite conflict
  if (QFileInfo::exists(destPath) && overwriteCallback) {
    OverwriteAction action = overwriteCallback(destPath);
    if (action == OverwriteAction::Skip || action == OverwriteAction::SkipAll)
      return true;
    if (action == OverwriteAction::Cancel)
      return false;
  }

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_raw(a);

  if (archive_read_open_filename(a, m_currentFile.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_read_free(a);
    return false;
  }

  struct archive_entry *entry;
  if (archive_read_next_header(a, &entry) != ARCHIVE_OK) {
    emit errorOccurred(tr("Failed to read compressed stream."));
    archive_read_free(a);
    return false;
  }

  QFile outFile(destPath);
  if (!outFile.open(QIODevice::WriteOnly)) {
    emit errorOccurred(tr("Cannot write to: %1").arg(destPath));
    archive_read_free(a);
    return false;
  }

  const void *buff;
  size_t size;
  la_int64_t offset;
  while (archive_read_data_block(a, &buff, &size, &offset) == ARCHIVE_OK) {
    outFile.write(reinterpret_cast<const char *>(buff), size);
  }

  outFile.close();
  archive_read_free(a);
  emit progressChanged(100);
  return true;
}

bool ArchiveManager::extractTo(const QString &destDir, OverwriteCallback overwriteCallback) {
  if (m_currentFile.isEmpty()) return false;

  QFileInfo fi(m_currentFile);
  QString ext = fi.suffix().toLower();
  bool isRawCompressed = (ext == "xz" || ext == "gz" || ext == "bz2" || ext == "zst" || ext == "lz4" || ext == "lzma")
    && m_entries.size() == 1 && m_entries[0].path == fi.completeBaseName();

  // For raw compressed files, extract directly without archive_write_disk
  if (isRawCompressed) {
    return extractRawCompressed(destDir, overwriteCallback);
  }

  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  struct archive *ext_disk = archive_write_disk_new();
  archive_write_disk_set_options(ext_disk, ARCHIVE_EXTRACT_TIME | ARCHIVE_EXTRACT_PERM);
  archive_write_disk_set_standard_lookup(ext_disk);

  if (archive_read_open_filename(a, m_currentFile.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_read_free(a);
    archive_write_free(ext_disk);
    return false;
  }

  int total = m_entries.size();
  int current = 0;
  bool replaceAll = false;
  bool skipAll = false;

  struct archive_entry *entry;
  while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    QString entryPath = destDir + "/" + QString::fromUtf8(archive_entry_pathname(entry));
    archive_entry_set_pathname(entry, entryPath.toUtf8().constData());

    // Check for overwrite conflict
    bool isDir = (archive_entry_filetype(entry) == AE_IFDIR);
    bool exists = isDir ? QDir(entryPath).exists() : QFileInfo::exists(entryPath);

    if (exists && !isDir && overwriteCallback && !replaceAll && !skipAll) {
      OverwriteAction action = overwriteCallback(entryPath);
      switch (action) {
        case OverwriteAction::ReplaceAll:
          replaceAll = true;
          break;
        case OverwriteAction::Replace:
          break;
        case OverwriteAction::Skip:
          archive_read_data_skip(a);
          current++;
          if (total > 0) emit progressChanged(current * 100 / total);
          continue;
        case OverwriteAction::SkipAll:
          skipAll = true;
          archive_read_data_skip(a);
          current++;
          if (total > 0) emit progressChanged(current * 100 / total);
          continue;
        case OverwriteAction::Cancel:
          archive_read_free(a);
          archive_write_free(ext_disk);
          return false;
      }
    } else if (exists && !isDir && skipAll) {
      archive_read_data_skip(a);
      current++;
      if (total > 0) emit progressChanged(current * 100 / total);
      continue;
    }

    if (archive_write_header(ext_disk, entry) != ARCHIVE_OK) continue;

    if (archive_entry_size(entry) > 0) {
      const void *buff;
      size_t size;
      la_int64_t offset;
      while (archive_read_data_block(a, &buff, &size, &offset) == ARCHIVE_OK)
        archive_write_data_block(ext_disk, buff, size, offset);
    }
    archive_write_finish_entry(ext_disk);

    current++;
    if (total > 0)
      emit progressChanged(current * 100 / total);
  }

  archive_read_free(a);
  archive_write_free(ext_disk);

#ifdef Q_OS_MACOS
  fixupMacOSApps(destDir);
#endif

  return true;
}

bool ArchiveManager::saveTo(const QString &destPath, const QList<ArchiveEntry> &entries, const QHash<QString, QString> &fileSources, const QString &originalArchive) {
  // Write to a temp file then rename (in case destPath == originalArchive)
  QString tmpPath = destPath + ".tmp";

  struct archive *a = archive_write_new();
  QFileInfo fi(destPath);
  QString ext = fi.suffix().toLower();
  QString base = fi.completeBaseName().toLower();

  if (ext == "zip" || ext == "jar")
    archive_write_set_format_zip(a);
  else if (ext == "7z")
    archive_write_set_format_7zip(a);
  else {
    archive_write_set_format_pax_restricted(a);
    if (ext == "gz" || ext == "tgz" || base.endsWith(".tar"))
      archive_write_add_filter_gzip(a);
    else if (ext == "bz2" || ext == "tbz")
      archive_write_add_filter_bzip2(a);
    else if (ext == "xz" || ext == "txz")
      archive_write_add_filter_xz(a);
    else if (ext == "zst" || ext == "tzst")
      archive_write_add_filter_zstd(a);
    else
      archive_write_add_filter_none(a);
  }

  if (archive_write_open_filename(a, tmpPath.toUtf8().constData()) != ARCHIVE_OK) {
    emit errorOccurred(QString::fromUtf8(archive_error_string(a)));
    archive_write_free(a);
    return false;
  }

  // Build map: original archive path -> new dest path for copy-through
  QHash<QString, QString> origPathToNewPath;
  for (const auto &e : entries) {
    if (!e.originalPath.isEmpty() && !fileSources.contains(e.path)) {
      origPathToNewPath[e.originalPath] = e.path;
    }
  }

  int total = entries.size();
  int current = 0;
  QSet<QString> written;

  // First pass: copy-through from original archive
  if (!originalArchive.isEmpty() && !origPathToNewPath.isEmpty()) {
    struct archive *src = archive_read_new();
    archive_read_support_filter_all(src);
    archive_read_support_format_all(src);

    if (archive_read_open_filename(src, originalArchive.toUtf8().constData(), 10240) == ARCHIVE_OK) {
      struct archive_entry *srcEntry;
      while (archive_read_next_header(src, &srcEntry) == ARCHIVE_OK) {
        QString srcPath = QString::fromUtf8(archive_entry_pathname(srcEntry));

        if (origPathToNewPath.contains(srcPath)) {
          QString newPath = origPathToNewPath[srcPath];
          // Set new pathname if renamed/moved
          if (newPath != srcPath)
            archive_entry_set_pathname(srcEntry, newPath.toUtf8().constData());

          archive_write_header(a, srcEntry);
          if (archive_entry_size(srcEntry) > 0) {
            const void *buff;
            size_t size;
            la_int64_t offset;
            while (archive_read_data_block(src, &buff, &size, &offset) == ARCHIVE_OK)
              archive_write_data_block(a, buff, size, offset);
          }
          archive_write_finish_entry(a);
          written.insert(newPath);
          current++;
          if (total > 0) emit progressChanged(current * 100 / total);
        } else {
          archive_read_data_skip(src);
        }
      }
    }
    archive_read_free(src);
  }

  // Second pass: write new entries from disk
  for (const auto &e : entries) {
    if (written.contains(e.path)) continue;

    struct archive_entry *entry = archive_entry_new();
    archive_entry_set_pathname(entry, e.path.toUtf8().constData());

    if (e.isDirectory) {
      archive_entry_set_filetype(entry, AE_IFDIR);
      archive_entry_set_perm(entry, 0755);
    } else {
      archive_entry_set_filetype(entry, AE_IFREG);
      archive_entry_set_perm(entry, 0644);
      if (fileSources.contains(e.path)) {
        QFileInfo sfi(fileSources[e.path]);
        archive_entry_set_size(entry, sfi.size());
      } else {
        archive_entry_set_size(entry, e.size);
      }
    }
    archive_entry_set_mtime(entry, e.modified.toSecsSinceEpoch(), 0);
    archive_write_header(a, entry);

    if (!e.isDirectory && fileSources.contains(e.path)) {
      QFile file(fileSources[e.path]);
      if (file.open(QIODevice::ReadOnly)) {
        char buf[8192];
        qint64 len;
        while ((len = file.read(buf, sizeof(buf))) > 0)
          archive_write_data(a, buf, len);
      }
    }

    archive_entry_free(entry);
    current++;
    if (total > 0) emit progressChanged(current * 100 / total);
  }

  archive_write_close(a);
  archive_write_free(a);

  // Replace original with temp file
  QFile::remove(destPath);
  QFile::rename(tmpPath, destPath);
  return true;
}

void ArchiveManager::fixupMacOSApps(const QString &directory) {
#ifdef Q_OS_MACOS
  // Scan the top-level extracted directory for .app bundles
  QDirIterator it(directory, QDir::Dirs | QDir::NoDotAndDotDot, QDirIterator::Subdirectories);
  QStringList appBundles;

  // Also check direct children
  QDir topDir(directory);
  for (const auto &entry : topDir.entryList(QDir::Dirs | QDir::NoDotAndDotDot)) {
    if (entry.endsWith(".app"))
      appBundles.append(topDir.absoluteFilePath(entry));
  }

  while (it.hasNext()) {
    QString path = it.next();
    if (path.endsWith(".app"))
      appBundles.append(path);
  }

  for (const QString &appPath : appBundles) {
    // Set executable permissions on all files in Contents/MacOS/
    QString macosDir = appPath + "/Contents/MacOS";
    QDir macos(macosDir);
    if (macos.exists()) {
      for (const auto &file : macos.entryList(QDir::Files)) {
        QString filePath = macos.absoluteFilePath(file);
        QFile::setPermissions(filePath,
          QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner |
          QFileDevice::ReadGroup | QFileDevice::ExeGroup |
          QFileDevice::ReadOther | QFileDevice::ExeOther);
      }
    }

    // Recursively remove com.apple.quarantine extended attribute
    QDirIterator qIt(appPath, QDir::AllEntries | QDir::NoDotAndDotDot | QDir::Hidden, QDirIterator::Subdirectories);
    removexattr(appPath.toUtf8().constData(), "com.apple.quarantine", 0);
    while (qIt.hasNext()) {
      QString filePath = qIt.next();
      removexattr(filePath.toUtf8().constData(), "com.apple.quarantine", 0);
    }
  }
#else
  Q_UNUSED(directory);
#endif
}

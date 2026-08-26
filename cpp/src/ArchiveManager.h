// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef ARCHIVEMANAGER_H
#define ARCHIVEMANAGER_H

#include <QObject>
#include <QStringList>
#include <QDateTime>
#include <functional>

struct ArchiveEntry {
  QString path;
  QString originalPath; // for save copy-through
  qint64 size;
  qint64 compressedSize;
  bool isDirectory;
  bool isSymlink;
  QDateTime modified;
  QString permissions;
  QString compressionMethod;
};

/// Response to an overwrite conflict prompt.
enum class OverwriteAction {
  Replace,    ///< Replace the existing file/folder
  ReplaceAll, ///< Replace all remaining conflicts without asking
  Skip,       ///< Skip this file
  SkipAll,    ///< Skip all remaining conflicts without asking
  Cancel      ///< Cancel the entire extraction
};

/// Callback invoked when an extraction would overwrite an existing file or folder.
/// The argument is the destination path that already exists.
/// Return the desired OverwriteAction.
using OverwriteCallback = std::function<OverwriteAction(const QString &existingPath)>;

class ArchiveManager : public QObject {
  Q_OBJECT

public:
  explicit ArchiveManager(QObject *parent = nullptr);

  bool open(const QString &filePath);
  void close();
  void setCurrentFile(const QString &filePath);
  QString currentFile() const;
  QList<ArchiveEntry> entries() const;
  bool extractTo(const QString &destDir, OverwriteCallback overwriteCallback = nullptr);
  bool saveTo(const QString &destPath, const QList<ArchiveEntry> &entries, const QHash<QString, QString> &fileSources, const QString &originalArchive);
  bool isReadOnly() const;

  /// Fix macOS .app bundles after extraction: set executable permissions and remove quarantine.
  static void fixupMacOSApps(const QString &directory);

signals:
  void archiveOpened(const QString &filePath);
  void progressChanged(int percent);
  void errorOccurred(const QString &message);

private:
  bool openRawCompressed(const QString &filePath);
  bool extractRawCompressed(const QString &destDir, OverwriteCallback overwriteCallback);
  QString m_currentFile;
  QList<ArchiveEntry> m_entries;
  bool m_readOnly = false;
};

#endif // ARCHIVEMANAGER_H

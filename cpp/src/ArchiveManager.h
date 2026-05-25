#ifndef ARCHIVEMANAGER_H
#define ARCHIVEMANAGER_H

#include <QObject>
#include <QStringList>
#include <QDateTime>

struct ArchiveEntry {
  QString path;
  qint64 size;
  qint64 compressedSize;
  bool isDirectory;
  bool isSymlink;
  QDateTime modified;
  QString permissions;
  QString compressionMethod;
};

class ArchiveManager : public QObject {
  Q_OBJECT

public:
  explicit ArchiveManager(QObject *parent = nullptr);

  bool open(const QString &filePath);
  void close();
  QString currentFile() const;
  QList<ArchiveEntry> entries() const;
  bool extractTo(const QString &destDir);
  bool isReadOnly() const;

signals:
  void archiveOpened(const QString &filePath);
  void progressChanged(int percent);
  void errorOccurred(const QString &message);

private:
  QString m_currentFile;
  QList<ArchiveEntry> m_entries;
  bool m_readOnly = false;
};

#endif // ARCHIVEMANAGER_H

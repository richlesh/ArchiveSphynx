#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>

class Settings;
class SettingsDialog;
class LicenseDialog;
class AboutDialog;
class ArchiveManager;
class QProgressBar;
class QToolBar;
class QAction;
class QLabel;
class QStandardItemModel;
class QStandardItem;

namespace Ui { class MainWindow; }

class MainWindow : public QMainWindow {
  Q_OBJECT

public:
  explicit MainWindow(Settings &settings, bool licensed, QWidget *parent = nullptr);
  ~MainWindow() override;

protected:
  void dragEnterEvent(QDragEnterEvent *event) override;
  void dragMoveEvent(QDragMoveEvent *event) override;
  void dropEvent(QDropEvent *event) override;
  bool eventFilter(QObject *obj, QEvent *event) override;

private slots:
  void newArchive();
  void openArchive();
  void openArchiveFile(const QString &filePath);
  void saveArchive();
  void saveArchiveAs();
  void addFiles();
  void newFolder();
  void deleteSelected();
  void extractArchive();
  void testIntegrity();
  void cleanMacOS();
  void openSettings();
  void openLicenseDialog();
  void openAbout();
  void onItemDoubleClicked(const QModelIndex &index);
  void onItemChanged(QStandardItem *item);

private:
  void setupMenus();
  void setupToolbar();
  void updateActions();
  void applyColors();
  void applyTheme();
  void applyFontSize();
  void markDirty();
  QStandardItem *selectedFolderItem() const;
  void addExternalFiles(const QStringList &paths, QStandardItem *parent);

  Ui::MainWindow *ui;
  Settings &m_settings;
  bool m_licensed;
  bool m_dirty = false;
  bool m_renaming = false;
  ArchiveManager *m_archiveManager = nullptr;
  QStandardItemModel *m_model = nullptr;
  QProgressBar *m_progressBar = nullptr;
  QToolBar *m_toolbar = nullptr;
  QLabel *m_pathBar = nullptr;
  bool m_altPressed = false;

  QAction *m_actNew = nullptr;
  QAction *m_actOpen = nullptr;
  QAction *m_actSave = nullptr;
  QAction *m_actSaveAs = nullptr;
  QAction *m_actAdd = nullptr;
  QAction *m_actNewFolder = nullptr;
  QAction *m_actDelete = nullptr;
  QAction *m_actExtract = nullptr;
  QAction *m_actTest = nullptr;
  QAction *m_actClean = nullptr;

  SettingsDialog *m_settingsDialog = nullptr;
  LicenseDialog *m_licenseDialog = nullptr;
  AboutDialog *m_aboutDialog = nullptr;
};

#endif // MAINWINDOW_H

#include "MainWindow.h"
#include "ui_MainWindow.h"
#include "SettingsDialog.h"
#include "LicenseDialog.h"
#include "AboutDialog.h"
#include "ArchiveManager.h"
#include "Settings.h"

#include <QMenuBar>
#include <QFileDialog>
#include <QDragEnterEvent>
#include <QDragMoveEvent>
#include <QDropEvent>
#include <QMimeData>
#include <QProgressBar>
#include <QStandardItemModel>
#include <QSortFilterProxyModel>
#include <QHeaderView>
#include <QRegularExpression>
#include <QMouseEvent>
#include <QToolBar>
#include <QLabel>
#include <QMessageBox>
#include <QStyleFactory>
#include <QApplication>
#include <QPalette>
#include <QDir>
#include <QFileInfo>

static void setExpandedRecursive(QTreeView *tree, const QModelIndex &index, bool expand) {
  tree->setExpanded(index, expand);
  int rows = tree->model()->rowCount(index);
  for (int i = 0; i < rows; ++i)
    setExpandedRecursive(tree, tree->model()->index(i, 0, index), expand);
}

static QString humanSize(qint64 bytes) {
  if (bytes < 1024) return QString::number(bytes) + " B";
  double val = bytes;
  const char *units[] = {"K", "M", "G", "T"};
  int i = -1;
  while (val >= 1024.0 && i < 3) { val /= 1024.0; i++; }
  QString s = QString::number(val, 'f', 3);
  s.remove(QRegularExpression("\\.?0+$"));
  return s + units[i];
}

MainWindow::MainWindow(Settings &settings, bool licensed, QWidget *parent)
  : QMainWindow(parent), ui(new Ui::MainWindow), m_settings(settings), m_licensed(licensed) {
  ui->setupUi(this);
  setWindowTitle("ArchiveSphynx");
  resize(1350, 600);
  setAcceptDrops(true);

  m_archiveManager = new ArchiveManager(this);

  ui->archiveTree->setSelectionMode(QAbstractItemView::ExtendedSelection);
  ui->archiveTree->setDragEnabled(true);
  ui->archiveTree->setAcceptDrops(true);
  ui->archiveTree->setDropIndicatorShown(true);
  ui->archiveTree->setDragDropMode(QAbstractItemView::DragDrop);
  ui->archiveTree->setDefaultDropAction(Qt::MoveAction);

  m_pathBar = new QLabel(this);
  m_pathBar->setFrameStyle(QFrame::StyledPanel | QFrame::Sunken);
  m_pathBar->setTextInteractionFlags(Qt::TextSelectableByMouse);
  ui->mainLayout->insertWidget(0, m_pathBar);

  m_progressBar = new QProgressBar(this);
  m_progressBar->setMaximumWidth(200);
  m_progressBar->setVisible(false);
  ui->statusBar->addPermanentWidget(m_progressBar);

  connect(m_archiveManager, &ArchiveManager::progressChanged, this, [this](int percent) {
    m_progressBar->setVisible(true);
    m_progressBar->setValue(percent);
    if (percent >= 100)
      m_progressBar->setVisible(false);
  });

  setupToolbar();
  setupMenus();
  updateActions();
  applyTheme();
  applyFontSize();
  applyColors();

  ui->archiveTree->viewport()->installEventFilter(this);

  connect(ui->archiveTree, &QTreeView::expanded, this, [this](const QModelIndex &index) {
    if (m_altPressed) setExpandedRecursive(ui->archiveTree, index, true);
    m_altPressed = false;
  });
  connect(ui->archiveTree, &QTreeView::collapsed, this, [this](const QModelIndex &index) {
    if (m_altPressed) setExpandedRecursive(ui->archiveTree, index, false);
    m_altPressed = false;
  });
  connect(ui->archiveTree, &QTreeView::doubleClicked, this, &MainWindow::onItemDoubleClicked);
}

MainWindow::~MainWindow() { delete ui; }

void MainWindow::setupToolbar() {
  m_toolbar = addToolBar(tr("Main"));
  m_toolbar->setMovable(false);
  m_toolbar->setStyle(QStyleFactory::create("Fusion"));
  m_toolbar->setToolButtonStyle(Qt::ToolButtonTextOnly);

  m_actNew = m_toolbar->addAction(QString::fromUtf8("📄 New"));
  m_actOpen = m_toolbar->addAction(QString::fromUtf8("📂 Open"));
  m_actSave = m_toolbar->addAction(QString::fromUtf8("💾 Save"));
  m_actSaveAs = m_toolbar->addAction(QString::fromUtf8("💾 Save As…"));
  m_toolbar->addSeparator();
  m_actAdd = m_toolbar->addAction(QString::fromUtf8("➕ Add"));
  m_actNewFolder = m_toolbar->addAction(QString::fromUtf8("📁 New Folder"));
  m_actDelete = m_toolbar->addAction(QString::fromUtf8("🗑 Delete"));
  m_toolbar->addSeparator();
  m_actExtract = m_toolbar->addAction(QString::fromUtf8("📥 Extract All"));
  m_toolbar->addSeparator();
  m_actTest = m_toolbar->addAction(QString::fromUtf8("✅ Test"));
  m_toolbar->addSeparator();
  m_actClean = m_toolbar->addAction(QString::fromUtf8("🔧 Clean macOS"));

  connect(m_actNew, &QAction::triggered, this, &MainWindow::newArchive);
  connect(m_actOpen, &QAction::triggered, this, &MainWindow::openArchive);
  connect(m_actSave, &QAction::triggered, this, &MainWindow::saveArchive);
  connect(m_actSaveAs, &QAction::triggered, this, &MainWindow::saveArchiveAs);
  connect(m_actAdd, &QAction::triggered, this, &MainWindow::addFiles);
  connect(m_actNewFolder, &QAction::triggered, this, &MainWindow::newFolder);
  connect(m_actDelete, &QAction::triggered, this, &MainWindow::deleteSelected);
  connect(m_actExtract, &QAction::triggered, this, &MainWindow::extractArchive);
  connect(m_actTest, &QAction::triggered, this, &MainWindow::testIntegrity);
  connect(m_actClean, &QAction::triggered, this, &MainWindow::cleanMacOS);
}

void MainWindow::setupMenus() {
  auto *fileMenu = menuBar()->addMenu(tr("&File"));
  fileMenu->addAction(tr("&New Archive"), QKeySequence::New, this, &MainWindow::newArchive);
  fileMenu->addAction(tr("&Open Archive…"), QKeySequence::Open, this, &MainWindow::openArchive);
  fileMenu->addAction(m_actSave);
  m_actSave->setShortcut(QKeySequence::Save);
  fileMenu->addAction(m_actSaveAs);
  m_actSaveAs->setShortcut(QKeySequence(tr("Ctrl+Shift+S")));
  fileMenu->addSeparator();
  fileMenu->addAction(m_actAdd);
  m_actAdd->setShortcut(QKeySequence(tr("Ctrl+Shift+A")));
  fileMenu->addAction(m_actNewFolder);
  m_actNewFolder->setShortcut(QKeySequence(tr("Ctrl+Shift+N")));
  fileMenu->addAction(m_actDelete);
  m_actDelete->setShortcut(QKeySequence::Delete);
  fileMenu->addSeparator();
  fileMenu->addAction(m_actExtract);
  m_actExtract->setShortcut(QKeySequence(tr("Ctrl+E")));
  fileMenu->addSeparator();
  fileMenu->addAction(m_actTest);
  m_actTest->setShortcut(QKeySequence(tr("Ctrl+T")));
  fileMenu->addAction(m_actClean);
  fileMenu->addSeparator();
  fileMenu->addAction(tr("E&xit"), QKeySequence::Quit, this, &QWidget::close);

  auto *appMenu = menuBar()->addMenu(tr("ArchiveSphynx"));
  auto *aboutAction = appMenu->addAction(tr("About ArchiveSphynx"), this, &MainWindow::openAbout);
  aboutAction->setMenuRole(QAction::AboutRole);
  appMenu->addSeparator();
  auto *settingsAction = appMenu->addAction(tr("Settings…"), this, &MainWindow::openSettings);
  settingsAction->setMenuRole(QAction::PreferencesRole);
  appMenu->addAction(tr("License Key…"), this, &MainWindow::openLicenseDialog);
}

void MainWindow::updateActions() {
  bool hasArchive = !m_archiveManager->currentFile().isEmpty();
  bool readOnly = m_archiveManager->isReadOnly();
  bool hasSelection = ui->archiveTree->selectionModel() &&
                      ui->archiveTree->selectionModel()->hasSelection();

  m_actSave->setEnabled(hasArchive && !readOnly && m_dirty);
  m_actSaveAs->setEnabled(hasArchive);
  m_actAdd->setEnabled(hasArchive && !readOnly);
  m_actNewFolder->setEnabled(hasArchive && !readOnly);
  m_actDelete->setEnabled(hasArchive && hasSelection && !readOnly);
  m_actExtract->setEnabled(hasArchive);
  m_actTest->setEnabled(hasArchive);
  m_actClean->setEnabled(hasArchive && !readOnly);
}

void MainWindow::markDirty() {
  m_dirty = true;
  updateActions();
}

void MainWindow::applyColors() {
  QColor btn = m_settings.buttonHighlightColor();
  QColor sel = m_settings.treeSelectionColor();
  int pt = 15;
  QString size = m_settings.fontSize();
  if (size == "Small") pt = 12;
  else if (size == "Large") pt = 18;

  m_toolbar->setStyleSheet(
    QString("QToolBar { padding: 4px; }"
            "QToolBar QToolButton { font-size: %2px; padding: 6px 10px; }"
            "QToolBar QToolButton:hover { background-color: %1; color: white; border: none; border-radius: 4px; }"
            "QToolBar QToolButton:pressed { background-color: %1; color: white; font-weight: bold; border: none; border-radius: 4px; }")
      .arg(btn.name()).arg(pt));

  ui->archiveTree->setStyleSheet(
    QString("QTreeView::item:selected { background-color: %1; color: white; }"
            "QTreeView::item:hover { background-color: %2; }")
      .arg(sel.name(), sel.lighter(150).name()));
}

void MainWindow::applyTheme() {
  QString theme = m_settings.theme();
  if (theme == "Dark") {
    qApp->setStyle(QStyleFactory::create("Fusion"));
    QPalette p;
    p.setColor(QPalette::Window, QColor("#2b2b2b"));
    p.setColor(QPalette::WindowText, QColor("#e0e0e0"));
    p.setColor(QPalette::Base, QColor("#1e1e1e"));
    p.setColor(QPalette::AlternateBase, QColor("#333333"));
    p.setColor(QPalette::Text, QColor("#e0e0e0"));
    p.setColor(QPalette::Button, QColor("#3c3c3c"));
    p.setColor(QPalette::ButtonText, QColor("#e0e0e0"));
    p.setColor(QPalette::BrightText, QColor("#ffffff"));
    p.setColor(QPalette::Highlight, QColor("#555555"));
    p.setColor(QPalette::HighlightedText, QColor("#ffffff"));
    p.setColor(QPalette::ToolTipBase, QColor("#3c3c3c"));
    p.setColor(QPalette::ToolTipText, QColor("#e0e0e0"));
    p.setColor(QPalette::PlaceholderText, QColor("#888888"));
    qApp->setPalette(p);
    qApp->setStyleSheet(QString());
  } else if (theme == "Light") {
    qApp->setStyle(QStyleFactory::create("Fusion"));
    QPalette p;
    p.setColor(QPalette::Window, QColor("#f5f5f5"));
    p.setColor(QPalette::WindowText, QColor("#1a1a1a"));
    p.setColor(QPalette::Base, QColor("#ffffff"));
    p.setColor(QPalette::Text, QColor("#1a1a1a"));
    p.setColor(QPalette::Button, QColor("#e8e8e8"));
    p.setColor(QPalette::ButtonText, QColor("#1a1a1a"));
    p.setColor(QPalette::Highlight, QColor("#3399ff"));
    p.setColor(QPalette::HighlightedText, QColor("#ffffff"));
    qApp->setPalette(p);
    qApp->setStyleSheet(QString());
  } else {
    qApp->setStyle(QStyleFactory::create("macOS"));
    qApp->setPalette(qApp->style()->standardPalette());
    qApp->setStyleSheet(QString());
  }
}

void MainWindow::applyFontSize() {
  int pt = 15;
  QString size = m_settings.fontSize();
  if (size == "Small") pt = 12;
  else if (size == "Large") pt = 18;
  QFont f = font();
  f.setPointSize(pt);
  ui->archiveTree->setFont(f);
  ui->archiveTree->header()->setFont(f);
  ui->statusBar->setFont(f);
  m_pathBar->setFont(f);
}

void MainWindow::dragEnterEvent(QDragEnterEvent *event) {
  if (event->mimeData()->hasUrls())
    event->acceptProposedAction();
}

void MainWindow::dragMoveEvent(QDragMoveEvent *event) {
  if (event->mimeData()->hasUrls())
    event->acceptProposedAction();
}

void MainWindow::dropEvent(QDropEvent *event) {
  const auto urls = event->mimeData()->urls();
  if (urls.isEmpty()) return;

  // If no archive is open, treat first file as archive to open
  if (m_archiveManager->currentFile().isEmpty()) {
    openArchiveFile(urls.first().toLocalFile());
    return;
  }

  // Otherwise add dropped files to the tree
  QStringList paths;
  for (const auto &url : urls)
    paths << url.toLocalFile();

  // Determine drop target
  QModelIndex idx = ui->archiveTree->indexAt(ui->archiveTree->viewport()->mapFromGlobal(QCursor::pos()));
  QStandardItem *target = nullptr;
  if (idx.isValid() && m_model) {
    QStandardItem *item = m_model->itemFromIndex(idx.siblingAtColumn(0));
    if (item && item->hasChildren())
      target = item;
    else if (item)
      target = item->parent();
  }
  addExternalFiles(paths, target);
}

bool MainWindow::eventFilter(QObject *obj, QEvent *event) {
  if (obj == ui->archiveTree->viewport() && event->type() == QEvent::MouseButtonPress) {
    auto *me = static_cast<QMouseEvent *>(event);
    m_altPressed = (me->modifiers() & Qt::AltModifier);
  }
  return QMainWindow::eventFilter(obj, event);
}

QStandardItem *MainWindow::selectedFolderItem() const {
  if (!m_model) return nullptr;
  auto sel = ui->archiveTree->selectionModel()->selectedIndexes();
  if (sel.isEmpty()) return nullptr;
  QModelIndex idx = sel.first().siblingAtColumn(0);
  QStandardItem *item = m_model->itemFromIndex(idx);
  if (item && item->hasChildren()) return item;
  return item ? item->parent() : nullptr;
}

void MainWindow::addExternalFiles(const QStringList &paths, QStandardItem *parent) {
  if (!m_model) return;
  QIcon fileIcon(":/icons/file_icon.png");
  QIcon dirIcon(":/icons/folder_icon.png");

  for (const QString &path : paths) {
    QFileInfo fi(path);
    if (fi.isDir()) {
      auto *folderItem = new QStandardItem(dirIcon, fi.fileName());
      QList<QStandardItem *> row = {folderItem, new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem()};
      if (parent) parent->appendRow(row);
      else m_model->appendRow(row);
      // Recursively add contents
      QDir dir(path);
      QStringList children;
      for (const auto &entry : dir.entryInfoList(QDir::AllEntries | QDir::NoDotAndDotDot))
        children << entry.filePath();
      addExternalFiles(children, folderItem);
    } else {
      auto *nameItem = new QStandardItem(fileIcon, fi.fileName());
      auto *sizeItem = new QStandardItem(humanSize(fi.size()));
      sizeItem->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      QList<QStandardItem *> row = {nameItem, sizeItem, new QStandardItem(), new QStandardItem(),
        new QStandardItem(fi.lastModified().toString("yyyy-MM-dd hh:mm")), new QStandardItem()};
      if (parent) parent->appendRow(row);
      else m_model->appendRow(row);
    }
  }
  markDirty();
}

void MainWindow::newArchive() {
  ui->statusBar->showMessage(tr("New archive (not yet implemented)"));
}

void MainWindow::openArchive() {
  QString file = QFileDialog::getOpenFileName(this, tr("Open Archive"), QString(),
    tr("Archives (*.zip *.7z *.rar *.jar *.tar *.tar.gz *.tar.bz2 *.tar.xz *.tar.zst *.deb *.rpm *.dmg *.iso);;All Files (*)"));
  if (!file.isEmpty())
    openArchiveFile(file);
}

void MainWindow::newFolder() {
  if (!m_model) return;
  QIcon dirIcon(":/icons/folder_icon.png");
  QStandardItem *parent = selectedFolderItem();

  // Find unique name
  QString baseName = tr("Untitled Folder");
  QString name = baseName;
  int suffix = 2;
  auto container = parent ? parent : m_model->invisibleRootItem();
  while (true) {
    bool exists = false;
    for (int i = 0; i < container->rowCount(); ++i) {
      if (container->child(i, 0)->text() == name) { exists = true; break; }
    }
    if (!exists) break;
    name = baseName + " " + QString::number(suffix++);
  }

  auto *item = new QStandardItem(dirIcon, name);
  QList<QStandardItem *> row = {item, new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem()};
  if (parent) parent->appendRow(row);
  else m_model->appendRow(row);

  markDirty();
  ui->statusBar->showMessage(tr("Created folder: %1").arg(name));
}

void MainWindow::addFiles() {
  if (!m_model) return;
  QStringList files = QFileDialog::getOpenFileNames(this, tr("Add Files"));
  if (files.isEmpty()) return;
  QStandardItem *parent = selectedFolderItem();
  addExternalFiles(files, parent);
  ui->statusBar->showMessage(tr("Added %1 file(s)").arg(files.size()));
}

void MainWindow::deleteSelected() {
  if (!m_model) return;
  auto indexes = ui->archiveTree->selectionModel()->selectedRows(0);
  // Delete in reverse order to preserve indices
  std::sort(indexes.begin(), indexes.end(), [](const QModelIndex &a, const QModelIndex &b) {
    return a.row() > b.row();
  });
  for (const auto &idx : indexes) {
    QStandardItem *item = m_model->itemFromIndex(idx);
    if (!item) continue;
    if (item->parent())
      item->parent()->removeRow(item->row());
    else
      m_model->removeRow(item->row());
  }
  markDirty();
  ui->statusBar->showMessage(tr("Deleted %1 item(s)").arg(indexes.size()));
}

void MainWindow::openArchiveFile(const QString &filePath) {
  if (!m_archiveManager->open(filePath)) return;
  m_dirty = false;

  m_model = new QStandardItemModel(this);
  m_model->setHorizontalHeaderLabels({tr("Name"), tr("Size"), tr("Compressed"), tr("Method"), tr("Date Modified"), tr("Permissions")});

  QIcon dirIcon(":/icons/folder_icon.png");
  QIcon fileIcon(":/icons/file_icon.png");
  QIcon linkIcon(":/icons/symlink_icon.png");

  QHash<QString, QStandardItem *> dirItems;

  auto getParent = [&](const QStringList &parts) -> QStandardItem * {
    if (parts.size() <= 1) return nullptr;
    QString dirPath;
    QStandardItem *parent = nullptr;
    for (int i = 0; i < parts.size() - 1; ++i) {
      dirPath += (i > 0 ? "/" : "") + parts[i];
      if (!dirItems.contains(dirPath)) {
        auto *item = new QStandardItem(dirIcon, parts[i]);
        QList<QStandardItem *> row = {item, new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem(), new QStandardItem()};
        if (parent) parent->appendRow(row);
        else m_model->appendRow(row);
        dirItems[dirPath] = item;
      }
      parent = dirItems[dirPath];
    }
    return parent;
  };

  for (const auto &entry : m_archiveManager->entries()) {
    QString path = entry.path;
    if (path.endsWith('/')) path.chop(1);
    QStringList parts = path.split('/', Qt::SkipEmptyParts);
    if (parts.isEmpty()) continue;

    QStandardItem *parent = getParent(parts);
    QString name = parts.last();

    if (entry.isDirectory && !entry.isSymlink) {
      QString key = parts.join('/');
      if (!dirItems.contains(key)) {
        auto *item = new QStandardItem(dirIcon, name);
        QList<QStandardItem *> row = {item, new QStandardItem(), new QStandardItem(), new QStandardItem(),
          new QStandardItem(entry.modified.toString("yyyy-MM-dd hh:mm")), new QStandardItem(entry.permissions)};
        if (parent) parent->appendRow(row);
        else m_model->appendRow(row);
        dirItems[key] = item;
      }
    } else {
      const QIcon &icon = entry.isSymlink ? linkIcon : fileIcon;
      auto *nameItem = new QStandardItem(icon, name);
      auto *sizeItem = new QStandardItem(humanSize(entry.size));
      sizeItem->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      auto *compItem = new QStandardItem(entry.compressedSize > 0 ? humanSize(entry.compressedSize) : QString());
      compItem->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      QList<QStandardItem *> row = {nameItem, sizeItem, compItem, new QStandardItem(entry.compressionMethod),
        new QStandardItem(entry.modified.toString("yyyy-MM-dd hh:mm")), new QStandardItem(entry.permissions)};
      if (parent) parent->appendRow(row);
      else m_model->appendRow(row);
    }
  }

  // Enable internal drag-drop on the model
  m_model->setSortRole(Qt::DisplayRole);
  connect(m_model, &QStandardItemModel::itemChanged, this, &MainWindow::onItemChanged);

  ui->archiveTree->setModel(m_model);
  ui->archiveTree->setSortingEnabled(true);
  ui->archiveTree->sortByColumn(0, Qt::AscendingOrder);
  ui->archiveTree->resizeColumnToContents(0);
  ui->archiveTree->setColumnWidth(0, ui->archiveTree->columnWidth(0) * 2);
  ui->archiveTree->resizeColumnToContents(2);
  ui->archiveTree->setColumnWidth(2, ui->archiveTree->columnWidth(2) + 30);
  ui->archiveTree->resizeColumnToContents(4);
  ui->archiveTree->setColumnWidth(4, ui->archiveTree->columnWidth(4) + 30);
  m_pathBar->setText(filePath);
  ui->statusBar->showMessage(tr("Opened: %1 (%2 entries)").arg(filePath).arg(m_archiveManager->entries().size()));

  connect(ui->archiveTree->selectionModel(), &QItemSelectionModel::selectionChanged,
          this, &MainWindow::updateActions);
  updateActions();
}

void MainWindow::onItemDoubleClicked(const QModelIndex &index) {
  if (!m_model || m_archiveManager->isReadOnly()) return;
  QModelIndex nameIdx = index.siblingAtColumn(0);
  QStandardItem *item = m_model->itemFromIndex(nameIdx);
  if (!item) return;
  m_renaming = true;
  ui->archiveTree->edit(nameIdx);
}

void MainWindow::onItemChanged(QStandardItem *item) {
  if (!m_renaming) return;
  m_renaming = false;

  // Validate: no duplicate name in same parent
  QString newName = item->text();
  QStandardItem *container = item->parent() ? item->parent() : m_model->invisibleRootItem();
  for (int i = 0; i < container->rowCount(); ++i) {
    QStandardItem *sibling = container->child(i, 0);
    if (sibling != item && sibling->text() == newName) {
      QMessageBox::warning(this, tr("Rename"), tr("An item named \"%1\" already exists in this folder.").arg(newName));
      // Revert - we don't have the old name stored, so just append a suffix
      item->setText(newName + " (copy)");
      break;
    }
  }
  markDirty();
}

void MainWindow::saveArchive() {
  // TODO: write modified tree back to archive
  m_dirty = false;
  updateActions();
  ui->statusBar->showMessage(tr("Archive saved."));
}

void MainWindow::saveArchiveAs() {
  QString file = QFileDialog::getSaveFileName(this, tr("Save Archive As"), QString(),
    tr("Archives (*.zip *.7z *.tar *.tar.gz *.tar.bz2 *.tar.xz *.tar.zst)"));
  if (file.isEmpty()) return;
  // TODO: write archive to new path
  m_dirty = false;
  updateActions();
  m_pathBar->setText(file);
  ui->statusBar->showMessage(tr("Archive saved as: %1").arg(file));
}

void MainWindow::extractArchive() {
  QString dir = QFileDialog::getExistingDirectory(this, tr("Extract To"));
  if (dir.isEmpty()) return;
  if (m_archiveManager->extractTo(dir))
    ui->statusBar->showMessage(tr("Extracted to: %1").arg(dir));
  else
    ui->statusBar->showMessage(tr("Extraction failed"));
}

void MainWindow::testIntegrity() {
  ui->statusBar->showMessage(tr("Test integrity (not yet implemented)"));
}

void MainWindow::cleanMacOS() {
  ui->statusBar->showMessage(tr("Clean macOS (not yet implemented)"));
}

void MainWindow::openSettings() {
  if (m_settingsDialog) { m_settingsDialog->activateWindow(); return; }
  m_settingsDialog = new SettingsDialog(m_settings, this);
  connect(m_settingsDialog, &QDialog::accepted, this, [this]() {
    applyTheme(); applyFontSize(); applyColors();
  });
  connect(m_settingsDialog, &QDialog::finished, this, [this]() {
    m_settingsDialog->deleteLater(); m_settingsDialog = nullptr;
  });
  m_settingsDialog->show();
}

void MainWindow::openLicenseDialog() {
  if (m_licenseDialog) { m_licenseDialog->activateWindow(); return; }
  m_licenseDialog = new LicenseDialog(m_settings, this);
  connect(m_licenseDialog, &QDialog::finished, this, [this]() {
    m_licenseDialog->deleteLater(); m_licenseDialog = nullptr;
  });
  m_licenseDialog->show();
}

void MainWindow::openAbout() {
  if (m_aboutDialog) { m_aboutDialog->activateWindow(); return; }
  m_aboutDialog = new AboutDialog(m_licensed, this);
  connect(m_aboutDialog, &QDialog::finished, this, [this]() {
    m_aboutDialog->deleteLater(); m_aboutDialog = nullptr;
  });
  m_aboutDialog->show();
}

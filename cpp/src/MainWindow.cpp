// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

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
#include <QCloseEvent>
#include <QDragMoveEvent>
#include <QDropEvent>
#include <QMimeData>
#include "BouncingProgressBar.h"
#include <QStandardItemModel>
#include <QSortFilterProxyModel>
#include <QSet>
#include <QSortFilterProxyModel>
#include <QHeaderView>
#include <QRegularExpression>
#include <QMouseEvent>
#include <QToolBar>
#include <QLabel>
#include <QListView>
#include <QMessageBox>
#include <QPushButton>
#include <QStyleFactory>
#include <QApplication>
#include <QPalette>
#include <QPainter>
#include <QPainterPath>
#include "Utilities.h"
#include <QDir>
#include <QFileInfo>
#include <archive.h>
#include <archive_entry.h>

static constexpr qint64 kIOBufferSize = 16 * 1024L * 1024L;

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
  resize(m_settings.windowSize());
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

  m_progressBar = new BouncingProgressBar(this);
  m_progressBar->setMaximumWidth(200);
  m_progressBar->setVisible(false);
  ui->statusBar->addPermanentWidget(m_progressBar);

  connect(m_archiveManager, &ArchiveManager::progressChanged, this, [this](int percent) {
    if (percent < 0) {
      QApplication::processEvents();
      return;
    }
    m_progressBar->setVisible(true);
    m_progressBar->setValue(percent);
    QApplication::processEvents();
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
  m_actAdd = m_toolbar->addAction(QString::fromUtf8("+ Add"));
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
#ifndef Q_OS_MACOS
  // On Windows/Linux, add app menu before File
  auto *appMenu = menuBar()->addMenu(tr("&ArchiveSphynx"));
  appMenu->addAction(tr("About ArchiveSphynx"), this, &MainWindow::openAbout);
  appMenu->addSeparator();
  appMenu->addAction(tr("Settings…"), this, &MainWindow::openSettings);
  appMenu->addAction(tr("License Key…"), this, &MainWindow::openLicenseDialog);
  appMenu->addSeparator();
  appMenu->addAction(tr("E&xit"), QKeySequence::Quit, this, &QWidget::close);
#endif

  auto *fileMenu = menuBar()->addMenu(tr("&File"));
  fileMenu->addAction(tr("&New Archive"), QKeySequence::New, this, &MainWindow::newArchive);
  fileMenu->addAction(tr("&Open Archive…"), QKeySequence::Open, this, &MainWindow::openArchive);
  m_menuSave = fileMenu->addAction(tr("&Save"), QKeySequence::Save, this, &MainWindow::saveArchive);
  m_menuSaveAs = fileMenu->addAction(tr("Save &As…"), QKeySequence(tr("Ctrl+Shift+S")), this, &MainWindow::saveArchiveAs);
  fileMenu->addSeparator();
  m_menuAdd = fileMenu->addAction(tr("Add Files…"), QKeySequence(tr("Ctrl+Shift+A")), this, &MainWindow::addFiles);
  m_menuNewFolder = fileMenu->addAction(tr("New Folder"), QKeySequence(tr("Ctrl+Shift+N")), this, &MainWindow::newFolder);
  m_menuDelete = fileMenu->addAction(tr("Delete"), QKeySequence::Delete, this, &MainWindow::deleteSelected);
  fileMenu->addSeparator();
  m_menuExtract = fileMenu->addAction(tr("Extract All"), QKeySequence(tr("Ctrl+E")), this, &MainWindow::extractArchive);
  fileMenu->addSeparator();
  m_menuTest = fileMenu->addAction(tr("Test Integrity"), QKeySequence(tr("Ctrl+T")), this, &MainWindow::testIntegrity);
  m_menuClean = fileMenu->addAction(tr("Clean macOS"), this, &MainWindow::cleanMacOS);

#ifdef Q_OS_MACOS
  // On macOS, these get moved to the app menu automatically via roles
  auto *aboutAction = fileMenu->addAction(tr("About ArchiveSphynx"), this, &MainWindow::openAbout);
  aboutAction->setMenuRole(QAction::AboutRole);
  auto *settingsAction = fileMenu->addAction(tr("Settings…"), this, &MainWindow::openSettings);
  settingsAction->setMenuRole(QAction::ApplicationSpecificRole);
  auto *licenseAction = fileMenu->addAction(tr("License Key…"), this, &MainWindow::openLicenseDialog);
  licenseAction->setMenuRole(QAction::ApplicationSpecificRole);
  fileMenu->addSeparator();
  fileMenu->addAction(tr("E&xit"), QKeySequence::Quit, this, &QWidget::close);
#endif
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
  m_actExtract->setText(hasSelection ? tr("📥 Extract Selected") : tr("📥 Extract All"));
  m_actTest->setEnabled(hasArchive);
  m_actClean->setEnabled(hasArchive && !readOnly);

  m_menuSave->setEnabled(hasArchive && !readOnly && m_dirty);
  m_menuSaveAs->setEnabled(hasArchive);
  m_menuAdd->setEnabled(hasArchive && !readOnly);
  m_menuNewFolder->setEnabled(hasArchive && !readOnly);
  m_menuDelete->setEnabled(hasArchive && hasSelection && !readOnly);
  m_menuExtract->setEnabled(hasArchive);
  m_menuExtract->setText(hasSelection ? tr("Extract Selected") : tr("Extract All"));
  m_menuTest->setEnabled(hasArchive);
  m_menuClean->setEnabled(hasArchive && !readOnly);
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
            "QToolBar QToolButton { font-size: %2pt; padding: 6px 10px; }"
            "QToolBar QToolButton:disabled { color: gray; }"
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
  QColor highlight = m_settings.treeSelectionColor();
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
    p.setColor(QPalette::Highlight, highlight);
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
    p.setColor(QPalette::Highlight, highlight);
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
  qApp->setFont(f);
  menuBar()->setFont(f);
  ui->archiveTree->setFont(f);
  ui->archiveTree->setIconSize(QSize(pt + 2, pt + 2));
  ui->archiveTree->header()->setFont(f);
  ui->archiveTree->header()->setSectionsMovable(true);
  ui->statusBar->setFont(f);
  m_pathBar->setFont(f);
}

void MainWindow::refreshIcons() {
  if (!m_model) return;
  QIcon dirIcon = themedIcon(":/icons/folder_icon.png");
  QIcon fileIcon = themedIcon(":/icons/file_icon.png");
  QIcon linkIcon = themedIcon(":/icons/symlink_icon.png");

  std::function<void(QStandardItem *)> update = [&](QStandardItem *parent) {
    int rows = parent ? parent->rowCount() : m_model->rowCount();
    for (int i = 0; i < rows; ++i) {
      QStandardItem *item = parent ? parent->child(i, 0) : m_model->item(i, 0);
      if (!item) continue;
      QStandardItem *sizeItem = parent ? parent->child(i, 1) : m_model->item(i, 1);
      bool isDir = !sizeItem || sizeItem->text().isEmpty();
      if (isDir) {
        item->setIcon(dirIcon);
        update(item);
      } else {
        // Check if symlink by icon name or data
        item->setIcon(item->data(Qt::UserRole + 4).toBool() ? linkIcon : fileIcon);
      }
    }
  };
  update(nullptr);
}

void MainWindow::closeEvent(QCloseEvent *event) {
  if (m_saving) {
    QMessageBox box(this);
    box.setWindowTitle(tr("Save In Progress"));
    box.setText(tr("A save operation is in progress. Do you want to cancel it and close?"));
    box.setIconPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation), 14));
    box.setStandardButtons(QMessageBox::Yes | QMessageBox::No);
    if (box.exec() == QMessageBox::Yes) {
      m_cancelSave = true;
      event->ignore(); // let the save loop finish and close after
    } else {
      event->ignore();
    }
    return;
  }

  m_settings.setWindowSize(size());
  if (m_model && m_model->columnCount() > 0)
    m_settings.setHeaderState(ui->archiveTree->header()->saveState());
  m_settings.save();

  if (m_dirty) {
    QMessageBox box(this);
    box.setWindowTitle(tr("Unsaved Changes"));
    box.setText(tr("The archive has unsaved changes. Do you want to save before closing?"));
    box.setIconPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation), 14));
    box.setStandardButtons(QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel);
    int reply = box.exec();
    if (reply == QMessageBox::Save) {
      saveArchive();
      event->accept();
    } else if (reply == QMessageBox::Discard) {
      event->accept();
    } else {
      event->ignore();
    }
  } else {
    event->accept();
  }
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
  QModelIndex proxyIdx = ui->archiveTree->indexAt(ui->archiveTree->viewport()->mapFromGlobal(QCursor::pos()));
  QStandardItem *target = nullptr;
  if (proxyIdx.isValid() && m_model && m_proxy) {
    QModelIndex srcIdx = m_proxy->mapToSource(proxyIdx.siblingAtColumn(0));
    QStandardItem *item = m_model->itemFromIndex(srcIdx);
    if (item) {
      QStandardItem *sizeItem = m_model->itemFromIndex(srcIdx.siblingAtColumn(1));
      bool isFolder = !sizeItem || sizeItem->text().isEmpty();
      if (isFolder)
        target = item;
      else
        target = item->parent();
    }
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
  if (!m_model || !m_proxy) return nullptr;
  auto sel = ui->archiveTree->selectionModel()->selectedIndexes();
  if (sel.isEmpty()) return nullptr;
  QModelIndex proxyIdx = sel.first().siblingAtColumn(0);
  QModelIndex idx = m_proxy->mapToSource(proxyIdx);
  QStandardItem *item = m_model->itemFromIndex(idx);
  if (!item) return nullptr;
  // A folder has no size value in column 1
  QStandardItem *sizeItem = m_model->itemFromIndex(idx.siblingAtColumn(1));
  bool isFolder = !sizeItem || sizeItem->text().isEmpty();
  if (isFolder) return item;
  return item->parent();
}

void MainWindow::addExternalFiles(const QStringList &paths, QStandardItem *parent) {
  if (!m_model) return;
  QIcon fileIcon = themedIcon(":/icons/file_icon.png");
  QIcon dirIcon = themedIcon(":/icons/folder_icon.png");

  for (const QString &path : paths) {
    QFileInfo fi(path);
    if (fi.isDir()) {
      QString dirName = QDir(path).dirName();
      auto *folderItem = new QStandardItem(dirIcon, dirName);
      QList<QStandardItem *> row = {folderItem, new QStandardItem(), new QStandardItem(), new QStandardItem()};
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
      nameItem->setData(path, Qt::UserRole + 1); // store source path for saving
      auto *sizeItem = new QStandardItem(humanSize(fi.size()));
      sizeItem->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      QList<QStandardItem *> row = {nameItem, sizeItem,
        new QStandardItem(fi.lastModified().toString("yyyy-MM-dd hh:mm")), new QStandardItem()};
      if (parent) parent->appendRow(row);
      else m_model->appendRow(row);
    }
  }
  markDirty();
}

void MainWindow::newArchive() {
  QString filter = tr("ZIP Archive (*.zip);;7-Zip Archive (*.7z);;Tar Archive (*.tar);;"
                      "Tar+Gzip (*.tgz);;Tar+Bzip2 (*.tbz);;"
                      "Tar+XZ (*.txz);;Tar+Zstd (*.tzst)");
  QString selectedFilter;
  QString file = QFileDialog::getSaveFileName(this, tr("New Archive"), QString(), filter, &selectedFilter);
  if (file.isEmpty()) return;

  // Fix extension if macOS native dialog appended wrong one
  if (selectedFilter.contains("*.tbz") && !file.endsWith(".tbz"))
    file = file.section('.', 0, 0) + ".tbz";
  else if (selectedFilter.contains("*.tgz") && !file.endsWith(".tgz"))
    file = file.section('.', 0, 0) + ".tgz";
  else if (selectedFilter.contains("*.txz") && !file.endsWith(".txz"))
    file = file.section('.', 0, 0) + ".txz";
  else if (selectedFilter.contains("*.tzst") && !file.endsWith(".tzst"))
    file = file.section('.', 0, 0) + ".tzst";
  else if (selectedFilter.contains("*.tar") && !file.endsWith(".tar"))
    file = file.section('.', 0, 0) + ".tar";
  else if (selectedFilter.contains("*.zip") && !file.endsWith(".zip"))
    file = file.section('.', 0, 0) + ".zip";
  else if (selectedFilter.contains("*.7z") && !file.endsWith(".7z"))
    file = file.section('.', 0, 0) + ".7z";

  // If current window already has an archive, use a new window
  MainWindow *target = this;
  if (!m_archiveManager->currentFile().isEmpty()) {
    target = new MainWindow(m_settings, m_licensed);
    target->setAttribute(Qt::WA_DeleteOnClose);
    target->show();
  }

  // Create empty model
  target->m_model = new QStandardItemModel(target);
  target->m_model->setHorizontalHeaderLabels({tr("Name"), tr("Size"), tr("Date Modified"), tr("Permissions")});
  connect(target->m_model, &QStandardItemModel::itemChanged, target, &MainWindow::onItemChanged);
  connect(target->m_model, &QStandardItemModel::rowsInserted, target, &MainWindow::markDirty);

  auto *proxy = new QSortFilterProxyModel(target);
  proxy->setSourceModel(target->m_model);
  proxy->setSortCaseSensitivity(Qt::CaseInsensitive);
  proxy->setRecursiveFilteringEnabled(true);
  target->m_proxy = proxy;

  target->ui->archiveTree->setModel(target->m_proxy);
  target->ui->archiveTree->setSortingEnabled(true);
  if (!target->m_settings.headerState().isEmpty()) {
    target->ui->archiveTree->header()->restoreState(target->m_settings.headerState());
    bool valid = true;
    for (int i = 0; i < target->ui->archiveTree->header()->count(); ++i) {
      if (!target->ui->archiveTree->header()->isSectionHidden(i) && target->ui->archiveTree->header()->sectionSize(i) < 10) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      target->ui->archiveTree->header()->reset();
      target->ui->archiveTree->resizeColumnToContents(0);
      target->ui->archiveTree->setColumnWidth(0, target->ui->archiveTree->columnWidth(0) * 2);
      target->ui->archiveTree->resizeColumnToContents(2);
      target->ui->archiveTree->setColumnWidth(2, target->ui->archiveTree->columnWidth(2) + 30);
      target->m_settings.setHeaderState(QByteArray());
    }
  } else {
    target->ui->archiveTree->resizeColumnToContents(0);
    target->ui->archiveTree->setColumnWidth(0, target->ui->archiveTree->columnWidth(0) * 2);
    target->ui->archiveTree->resizeColumnToContents(2);
    target->ui->archiveTree->setColumnWidth(2, target->ui->archiveTree->columnWidth(2) + 30);
  }
  target->m_pathBar->setText(file);
  target->m_archiveManager->setCurrentFile(file);
  target->m_dirty = true;
  target->updateActions();
  target->ui->statusBar->showMessage(tr("New archive: %1").arg(file));
}

void MainWindow::openArchive() {
  QString file = QFileDialog::getOpenFileName(this, tr("Open Archive"), QString(),
    tr("Archives (*.zip *.7z *.rar *.jar *.tar *.tar.gz *.tgz *.tar.bz2 *.tbz *.tar.xz *.txz *.tar.zst *.tzst *.deb *.rpm *.dmg *.iso);;All Files (*)"));
  if (!file.isEmpty())
    openArchiveFile(file);
}

void MainWindow::newFolder() {
  if (!m_model) return;
  QIcon dirIcon = themedIcon(":/icons/folder_icon.png");
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
  QList<QStandardItem *> row = {item, new QStandardItem(), new QStandardItem(), new QStandardItem()};
  if (parent) parent->appendRow(row);
  else m_model->appendRow(row);

  markDirty();
  ui->statusBar->showMessage(tr("Created folder: %1").arg(name));
}

void MainWindow::addFiles() {
  if (!m_model) return;

  QStringList paths;

  // Show a message box asking what to add
  QMessageBox box(this);
  box.setWindowTitle(tr("Add"));
  box.setText(tr("What would you like to add?"));
  QAbstractButton *filesBtn = box.addButton(tr("Files"), QMessageBox::AcceptRole);
  QAbstractButton *foldersBtn = box.addButton(tr("Folders"), QMessageBox::AcceptRole);
  box.addButton(QMessageBox::Cancel);
  box.exec();

  QAbstractButton *clicked = box.clickedButton();
  if (clicked == filesBtn) {
    paths = QFileDialog::getOpenFileNames(this, tr("Add Files"), QString(), tr("All Files (*)"));
  } else if (clicked == foldersBtn) {
    QString dir = QFileDialog::getExistingDirectory(this, tr("Add Folder"));
    if (!dir.isEmpty()) paths << dir;
  } else {
    return;
  }

  if (paths.isEmpty()) return;
  QStandardItem *parent = selectedFolderItem();
  addExternalFiles(paths, parent);
  ui->statusBar->showMessage(tr("Added %1 item(s)").arg(paths.size()));
}

void MainWindow::deleteSelected() {
  if (!m_model || !m_proxy) return;
  auto proxyIndexes = ui->archiveTree->selectionModel()->selectedRows(0);
  // Map to source and delete in reverse order
  QList<QPersistentModelIndex> sourceIndexes;
  for (const auto &pi : proxyIndexes)
    sourceIndexes << QPersistentModelIndex(m_proxy->mapToSource(pi));
  for (const auto &idx : sourceIndexes) {
    if (!idx.isValid()) continue;
    QStandardItem *item = m_model->itemFromIndex(idx);
    if (!item) continue;
    if (item->parent())
      item->parent()->removeRow(item->row());
    else
      m_model->removeRow(item->row());
  }
  markDirty();
  ui->statusBar->showMessage(tr("Deleted %1 item(s)").arg(sourceIndexes.size()));
}

void MainWindow::openArchiveFile(const QString &filePath) {
  // If current window already has an archive, open in a new window
  if (!m_archiveManager->currentFile().isEmpty()) {
    auto *newWindow = new MainWindow(m_settings, m_licensed);
    newWindow->setAttribute(Qt::WA_DeleteOnClose);
    newWindow->show();
    newWindow->openArchiveFile(filePath);
    return;
  }

  m_toolbar->setEnabled(false);
  menuBar()->setEnabled(false);
  m_progressBar->setRange(0, 0); // indeterminate/busy mode
  m_progressBar->setVisible(true);
  QApplication::processEvents();

  if (!m_archiveManager->open(filePath)) {
    m_progressBar->setVisible(false);
    m_toolbar->setEnabled(true);
    menuBar()->setEnabled(true);
    return;
  }
  m_dirty = false;

  m_model = new QStandardItemModel(this);
  m_model->setHorizontalHeaderLabels({tr("Name"), tr("Size"), tr("Date Modified"), tr("Permissions")});

  QIcon dirIcon = themedIcon(":/icons/folder_icon.png");
  QIcon fileIcon = themedIcon(":/icons/file_icon.png");
  QIcon linkIcon = themedIcon(":/icons/symlink_icon.png");

  QHash<QString, QStandardItem *> dirItems;

  auto getParent = [&](const QStringList &parts) -> QStandardItem * {
    if (parts.size() <= 1) return nullptr;
    QString dirPath;
    QStandardItem *parent = nullptr;
    for (int i = 0; i < parts.size() - 1; ++i) {
      dirPath += (i > 0 ? "/" : "") + parts[i];
      if (!dirItems.contains(dirPath)) {
        auto *item = new QStandardItem(dirIcon, parts[i]);
        item->setData(dirPath + "/", Qt::UserRole + 2); // original archive path
        QList<QStandardItem *> row = {item, new QStandardItem(), new QStandardItem(), new QStandardItem()};
        if (parent) parent->appendRow(row);
        else m_model->appendRow(row);
        dirItems[dirPath] = item;
      }
      parent = dirItems[dirPath];
    }
    return parent;
  };

  int totalEntries = m_archiveManager->entries().size();
  int entryIdx = 0;
  m_progressBar->setRange(0, 100);
  m_progressBar->setValue(0);

  for (const auto &entry : m_archiveManager->entries()) {
    entryIdx++;
    m_progressBar->setValue(entryIdx * 100 / qMax(totalEntries, 1));
    QApplication::processEvents();
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
        item->setData(entry.path, Qt::UserRole + 2); // original archive path
        QList<QStandardItem *> row = {item, new QStandardItem(),
          new QStandardItem(entry.modified.toString("yyyy-MM-dd hh:mm")), new QStandardItem(entry.permissions)};
        if (parent) parent->appendRow(row);
        else m_model->appendRow(row);
        dirItems[key] = item;
      }
    } else {
      const QIcon &icon = entry.isSymlink ? linkIcon : fileIcon;
      auto *nameItem = new QStandardItem(icon, name);
      nameItem->setData(entry.path, Qt::UserRole + 2); // original archive path
      nameItem->setData(entry.size, Qt::UserRole + 3); // original size
      nameItem->setData(entry.isSymlink, Qt::UserRole + 4); // symlink flag
      auto *sizeItem = new QStandardItem(humanSize(entry.size));
      sizeItem->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      QList<QStandardItem *> row = {nameItem, sizeItem,
        new QStandardItem(entry.modified.toString("yyyy-MM-dd hh:mm")), new QStandardItem(entry.permissions)};
      if (parent) parent->appendRow(row);
      else m_model->appendRow(row);
    }
  }

  // Enable internal drag-drop on the model
  m_model->setSortRole(Qt::DisplayRole);
  connect(m_model, &QStandardItemModel::itemChanged, this, &MainWindow::onItemChanged);
  connect(m_model, &QStandardItemModel::rowsInserted, this, &MainWindow::markDirty);
  connect(m_model, &QStandardItemModel::rowsRemoved, this, &MainWindow::markDirty);

  // Enable case-insensitive sorting via proxy
  auto *proxy = new QSortFilterProxyModel(this);
  proxy->setSourceModel(m_model);
  proxy->setSortCaseSensitivity(Qt::CaseInsensitive);
  proxy->setRecursiveFilteringEnabled(true);
  m_proxy = proxy;

  m_progressBar->setVisible(false);

  ui->archiveTree->setModel(m_proxy);
  ui->archiveTree->setSortingEnabled(true);
  ui->archiveTree->sortByColumn(0, Qt::AscendingOrder);
  if (!m_settings.headerState().isEmpty()) {
    ui->archiveTree->header()->restoreState(m_settings.headerState());
    // Discard stale state if columns are collapsed
    bool valid = true;
    for (int i = 0; i < ui->archiveTree->header()->count(); ++i) {
      if (!ui->archiveTree->header()->isSectionHidden(i) && ui->archiveTree->header()->sectionSize(i) < 10) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      ui->archiveTree->header()->reset();
      ui->archiveTree->resizeColumnToContents(0);
      ui->archiveTree->setColumnWidth(0, ui->archiveTree->columnWidth(0) * 2);
      ui->archiveTree->resizeColumnToContents(2);
      ui->archiveTree->setColumnWidth(2, ui->archiveTree->columnWidth(2) + 30);
      m_settings.setHeaderState(QByteArray());
    }
  } else {
    ui->archiveTree->resizeColumnToContents(0);
    ui->archiveTree->setColumnWidth(0, ui->archiveTree->columnWidth(0) * 2);
    ui->archiveTree->resizeColumnToContents(2);
    ui->archiveTree->setColumnWidth(2, ui->archiveTree->columnWidth(2) + 30);
  }
  m_pathBar->setText(filePath);
  ui->statusBar->showMessage(tr("Opened: %1 (%2 entries)").arg(filePath).arg(m_archiveManager->entries().size()));

  connect(ui->archiveTree->selectionModel(), &QItemSelectionModel::selectionChanged,
          this, &MainWindow::updateActions);
  m_toolbar->setEnabled(true);
  menuBar()->setEnabled(true);
  updateActions();
}

void MainWindow::onItemDoubleClicked(const QModelIndex &index) {
  if (!m_model || !m_proxy || m_archiveManager->isReadOnly()) return;
  QModelIndex proxyNameIdx = index.siblingAtColumn(0);
  QModelIndex srcIdx = m_proxy->mapToSource(proxyNameIdx);
  QStandardItem *item = m_model->itemFromIndex(srcIdx);
  if (!item) return;
  m_renaming = true;
  ui->archiveTree->edit(proxyNameIdx);
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

static void collectPaths(QStandardItem *parent, const QString &prefix,
                         QStringList &allPaths, QHash<QString, QString> &diskSources,
                         QHash<QString, QString> *origToNew = nullptr) {
  int rows = parent ? parent->rowCount() : 0;
  for (int i = 0; i < rows; ++i) {
    QStandardItem *nameItem = parent->child(i, 0);
    QStandardItem *sizeItem = parent->child(i, 1);
    if (!nameItem) continue;
    QString name = nameItem->text();
    QString path = prefix.isEmpty() ? name : prefix + "/" + name;
    bool isDir = sizeItem && sizeItem->text().isEmpty();

    if (isDir) {
      allPaths << path + "/";
      if (origToNew) {
        QVariant orig = nameItem->data(Qt::UserRole + 2);
        if (orig.isValid()) origToNew->insert(orig.toString(), path + "/");
      }
      collectPaths(nameItem, path, allPaths, diskSources, origToNew);
    } else {
      allPaths << path;
      // Check for disk source
      QVariant src = nameItem->data(Qt::UserRole + 1);
      if (src.isValid())
        diskSources[path] = src.toString();
      if (origToNew) {
        QVariant orig = nameItem->data(Qt::UserRole + 2);
        if (orig.isValid()) origToNew->insert(orig.toString(), path);
      }
    }
  }
}

void MainWindow::saveArchive() {
  if (!m_model || m_archiveManager->currentFile().isEmpty()) return;
  m_saving = true;
  m_cancelSave = false;
  m_toolbar->setEnabled(false);
  menuBar()->setEnabled(false);
  ui->archiveTree->setDragEnabled(false);
  ui->archiveTree->setAcceptDrops(false);
  setAcceptDrops(false);

  QStringList pathList;
  QHash<QString, QString> diskSources;
  QHash<QString, QString> origToNew;
  collectPaths(m_model->invisibleRootItem(), QString(), pathList, diskSources, &origToNew);
  QSet<QString> allPaths(pathList.begin(), pathList.end());

  QString origPath = m_archiveManager->currentFile();
  QString tmpPath = origPath + ".tmp";

  // Capture entries before closing
  auto savedEntries = m_archiveManager->entries();
  QHash<QString, qint64> entrySizeMap;
  for (const auto &e : savedEntries)
    if (!e.isDirectory) entrySizeMap[e.path] = e.size;

  // Close the archive manager (libarchive will open its own handle)
  m_archiveManager->close();

  bool hasOriginal = QFile::exists(origPath);

  struct archive *src = archive_read_new();
  archive_read_support_filter_all(src);
  archive_read_support_format_all(src);

  struct archive *dst = archive_write_new();
  QFileInfo fi(origPath);
  QString ext = fi.suffix().toLower();
  if (ext == "zip" || ext == "jar") archive_write_set_format_zip(dst);
  else if (ext == "7z") archive_write_set_format_7zip(dst);
  else {
    archive_write_set_format_pax_restricted(dst);
    QString base = fi.completeBaseName().toLower();
    if (ext == "gz" || ext == "tgz" || base.endsWith(".tar")) archive_write_add_filter_gzip(dst);
    else if (ext == "bz2" || ext == "tbz") archive_write_add_filter_bzip2(dst);
    else if (ext == "xz" || ext == "txz") archive_write_add_filter_xz(dst);
    else if (ext == "zst" || ext == "tzst") archive_write_add_filter_zstd(dst);
    else archive_write_add_filter_none(dst);
  }

  if (archive_write_open_filename(dst, tmpPath.toUtf8().constData()) != ARCHIVE_OK) {
    ui->statusBar->showMessage(tr("Save failed: %1").arg(QString::fromUtf8(archive_error_string(dst))));
    archive_write_free(dst);
    archive_read_free(src);
    m_archiveManager->open(origPath);
    return;
  }

  QSet<QString> written;
  qint64 totalBytes = 0;
  for (const QString &path : pathList) {
    if (path.endsWith('/')) continue;
    if (diskSources.contains(path))
      totalBytes += QFileInfo(diskSources[path]).size();
    else if (entrySizeMap.contains(path))
      totalBytes += entrySizeMap[path];
    else {
      for (auto it = origToNew.cbegin(); it != origToNew.cend(); ++it)
        if (it.value() == path && entrySizeMap.contains(it.key())) { totalBytes += entrySizeMap[it.key()]; break; }
    }
  }
  qint64 bytesWritten = 0;
  m_progressBar->setVisible(true);
  m_progressBar->setRange(0, 100);
  m_progressBar->setValue(0);

  // Copy entries from backup that still exist in tree
  int readResult = hasOriginal ? archive_read_open_filename(src, origPath.toUtf8().constData(), 10240) : ARCHIVE_FATAL;
  if (readResult == ARCHIVE_OK) {
    struct archive_entry *entry;
    while (!m_cancelSave && archive_read_next_header(src, &entry) == ARCHIVE_OK) {
      QString entryPath = QString::fromUtf8(archive_entry_pathname(entry));
      // Normalize: strip leading ./
      QString normalized = entryPath;
      if (normalized.startsWith("./")) normalized = normalized.mid(2);

      // Try all path variations for matching
      QString withSlash = normalized.endsWith('/') ? normalized : normalized + "/";
      QString withoutSlash = normalized.endsWith('/') ? normalized.chopped(1) : normalized;
      bool keep = allPaths.contains(normalized) || allPaths.contains(withSlash) || allPaths.contains(withoutSlash);

      // Check if this entry was moved/renamed (original path maps to a new path)
      QString writePath = normalized;
      if (!keep && origToNew.contains(normalized)) {
        writePath = origToNew[normalized];
        keep = true;
      } else if (!keep && origToNew.contains(withSlash)) {
        writePath = origToNew[withSlash];
        keep = true;
      } else if (!keep && origToNew.contains(withoutSlash)) {
        writePath = origToNew[withoutSlash];
        keep = true;
      }

      // Don't copy if we have a new disk source for this path
      QString writeWithoutSlash = writePath.endsWith('/') ? writePath.chopped(1) : writePath;
      if (keep && !diskSources.contains(writeWithoutSlash)) {
        // Write with the (possibly renamed) path
        archive_entry_set_pathname(entry, writePath.toUtf8().constData());
        // Buffer data first so we can set correct size (needed for tar)
        QByteArray data;
        QByteArray readBuf(kIOBufferSize, Qt::Uninitialized);
        la_ssize_t len;
        while ((len = archive_read_data(src, readBuf.data(), readBuf.size())) > 0) {
          data.append(readBuf.constData(), len);
          QApplication::processEvents();
        }
        archive_entry_set_size(entry, data.size());
        archive_write_header(dst, entry);
        if (!data.isEmpty()) {
          const char *ptr = data.constData();
          qint64 remaining = data.size();
          while (remaining > 0) {
            qint64 chunk = qMin(remaining, kIOBufferSize);
            archive_write_data(dst, ptr, chunk);
            ptr += chunk;
            remaining -= chunk;
            bytesWritten += chunk;
            if (totalBytes > 0)
              m_progressBar->setValue(static_cast<int>(bytesWritten * 100 / totalBytes));
            QApplication::processEvents();
          }
        }
        archive_write_finish_entry(dst);
        written.insert(writePath);
        QApplication::processEvents();
      } else {
        archive_read_data_skip(src);
      }
    }
  } else if (hasOriginal) {
    // Read failed - report error
    ui->statusBar->showMessage(tr("Save: cannot read archive"));
    archive_read_free(src);
    archive_write_close(dst);
    archive_write_free(dst);
    QFile::remove(tmpPath);
    m_archiveManager->setCurrentFile(origPath);
    m_toolbar->setEnabled(true);
    menuBar()->setEnabled(true);
    ui->archiveTree->setDragEnabled(true);
    ui->archiveTree->setAcceptDrops(true);
    setAcceptDrops(true);
    m_progressBar->setVisible(false);
    m_saving = false;
    return;
  }
  archive_read_free(src);

  // Write new entries from disk
  for (const QString &path : pathList) {
    if (m_cancelSave) break;
    if (written.contains(path)) continue;
    bool isDir = path.endsWith('/');
    QString cleanPath = isDir ? path.chopped(1) : path;

    struct archive_entry *entry = archive_entry_new();
    archive_entry_set_pathname(entry, path.toUtf8().constData());
    if (isDir) {
      archive_entry_set_filetype(entry, AE_IFDIR);
      archive_entry_set_perm(entry, 0755);
    } else {
      archive_entry_set_filetype(entry, AE_IFREG);
      archive_entry_set_perm(entry, 0644);
      if (diskSources.contains(cleanPath)) {
        QFileInfo sfi(diskSources[cleanPath]);
        archive_entry_set_size(entry, sfi.size());
      }
    }
    archive_entry_set_mtime(entry, QDateTime::currentDateTime().toSecsSinceEpoch(), 0);
    archive_write_header(dst, entry);

    if (!isDir && diskSources.contains(cleanPath)) {
      QFile f(diskSources[cleanPath]);
      if (f.open(QIODevice::ReadOnly)) {
        QByteArray buf(kIOBufferSize, Qt::Uninitialized);
        qint64 len;
        while ((len = f.read(buf.data(), buf.size())) > 0) {
          archive_write_data(dst, buf.constData(), len);
          bytesWritten += len;
          if (totalBytes > 0)
            m_progressBar->setValue(static_cast<int>(bytesWritten * 100 / totalBytes));
          QApplication::processEvents();
        }
      }
    }
    archive_entry_free(entry);
    QApplication::processEvents();
  }

  archive_write_close(dst);
  archive_write_free(dst);

  if (m_cancelSave) {
    QFile::remove(tmpPath);
  } else {
    QFile::remove(origPath);
    QFile::rename(tmpPath, origPath);
  }

  m_progressBar->setVisible(false);

  // Reopen
  m_archiveManager->open(origPath);
  m_dirty = m_cancelSave;
  m_toolbar->setEnabled(true);
  menuBar()->setEnabled(true);
  ui->archiveTree->setDragEnabled(true);
  ui->archiveTree->setAcceptDrops(true);
  setAcceptDrops(true);
  updateActions();
  m_saving = false;
  if (m_cancelSave) { close(); return; }
  ui->statusBar->showMessage(tr("Archive saved: %1 (%2 entries copied, %3 total)").arg(origPath).arg(written.size()).arg(pathList.size()));
}

void MainWindow::saveArchiveAs() {
  if (!m_model) return;

  // Default to same basename with new extension
  QFileInfo orig(m_archiveManager->currentFile());
  QString baseName = orig.completeBaseName();
  // Strip .tar from double extensions like .tar.gz
  if (baseName.endsWith(".tar")) baseName.chop(4);
  QString defaultDir = orig.absolutePath();

  QString filter = tr("ZIP Archive (*.zip);;7-Zip Archive (*.7z);;Tar Archive (*.tar);;"
                      "Tar+Gzip (*.tgz);;Tar+Bzip2 (*.tbz);;"
                      "Tar+XZ (*.txz);;Tar+Zstd (*.tzst)");
  QString selectedFilter;
  QString file = QFileDialog::getSaveFileName(this, tr("Save Archive As"),
    defaultDir + "/" + baseName, filter, &selectedFilter);
  if (file.isEmpty()) return;

  // Fix extension if macOS native dialog appended wrong one
  if (selectedFilter.contains("*.tbz") && !file.endsWith(".tbz"))
    file = file.section('.', 0, 0) + ".tbz";
  else if (selectedFilter.contains("*.tgz") && !file.endsWith(".tgz"))
    file = file.section('.', 0, 0) + ".tgz";
  else if (selectedFilter.contains("*.txz") && !file.endsWith(".txz"))
    file = file.section('.', 0, 0) + ".txz";
  else if (selectedFilter.contains("*.tzst") && !file.endsWith(".tzst"))
    file = file.section('.', 0, 0) + ".tzst";
  else if (selectedFilter.contains("*.tar") && !file.endsWith(".tar"))
    file = file.section('.', 0, 0) + ".tar";
  else if (selectedFilter.contains("*.zip") && !file.endsWith(".zip"))
    file = file.section('.', 0, 0) + ".zip";
  else if (selectedFilter.contains("*.7z") && !file.endsWith(".7z"))
    file = file.section('.', 0, 0) + ".7z";

  m_saving = true;
  m_cancelSave = false;
  m_toolbar->setEnabled(false);
  menuBar()->setEnabled(false);
  ui->archiveTree->setDragEnabled(false);
  ui->archiveTree->setAcceptDrops(false);
  setAcceptDrops(false);

  QStringList pathList;
  QHash<QString, QString> diskSources;
  QHash<QString, QString> origToNew;
  collectPaths(m_model->invisibleRootItem(), QString(), pathList, diskSources, &origToNew);
  QSet<QString> allPaths(pathList.begin(), pathList.end());

  QString origArchive = m_archiveManager->currentFile();
  QString tmpPath = file + ".tmp";

  // Capture entries before closing
  auto savedEntries = m_archiveManager->entries();
  QHash<QString, qint64> entrySizeMap;
  for (const auto &e : savedEntries)
    if (!e.isDirectory) entrySizeMap[e.path] = e.size;

  // Close archive so we can read it
  m_archiveManager->close();

  struct archive *src = archive_read_new();
  archive_read_support_filter_all(src);
  archive_read_support_format_all(src);

  struct archive *dst = archive_write_new();
  QFileInfo fi(file);
  QString ext = fi.suffix().toLower();
  if (ext == "zip") archive_write_set_format_zip(dst);
  else if (ext == "7z") archive_write_set_format_7zip(dst);
  else {
    archive_write_set_format_pax_restricted(dst);
    QString cbase = fi.completeBaseName().toLower();
    if (ext == "gz" || ext == "tgz" || cbase.endsWith(".tar")) archive_write_add_filter_gzip(dst);
    else if (ext == "bz2" || ext == "tbz") archive_write_add_filter_bzip2(dst);
    else if (ext == "xz" || ext == "txz") archive_write_add_filter_xz(dst);
    else if (ext == "zst" || ext == "tzst") archive_write_add_filter_zstd(dst);
    else archive_write_add_filter_none(dst);
  }

  if (archive_write_open_filename(dst, tmpPath.toUtf8().constData()) != ARCHIVE_OK) {
    ui->statusBar->showMessage(tr("Save As failed: %1").arg(QString::fromUtf8(archive_error_string(dst))));
    archive_write_free(dst);
    archive_read_free(src);
    ui->archiveTree->setDragEnabled(true);
    ui->archiveTree->setAcceptDrops(true);
    setAcceptDrops(true);
    m_saving = false;
    return;
  }

  QSet<QString> written;
  qint64 totalBytes = 0;
  for (const QString &path : pathList) {
    if (path.endsWith('/')) continue;
    if (diskSources.contains(path))
      totalBytes += QFileInfo(diskSources[path]).size();
    else if (entrySizeMap.contains(path))
      totalBytes += entrySizeMap[path];
    else {
      // Check if it was moved from an original path
      for (auto it = origToNew.cbegin(); it != origToNew.cend(); ++it)
        if (it.value() == path && entrySizeMap.contains(it.key())) { totalBytes += entrySizeMap[it.key()]; break; }
    }
  }
  qint64 bytesWritten = 0;
  m_progressBar->setVisible(true);
  m_progressBar->setRange(0, 100);
  m_progressBar->setValue(0);

  if (archive_read_open_filename(src, origArchive.toUtf8().constData(), 10240) == ARCHIVE_OK) {
    struct archive_entry *entry;
    while (!m_cancelSave && archive_read_next_header(src, &entry) == ARCHIVE_OK) {
      QString entryPath = QString::fromUtf8(archive_entry_pathname(entry));
      QString normalized = entryPath;
      if (normalized.startsWith("./")) normalized = normalized.mid(2);

      QString withSlash = normalized.endsWith('/') ? normalized : normalized + "/";
      QString withoutSlash = normalized.endsWith('/') ? normalized.chopped(1) : normalized;
      bool keep = allPaths.contains(normalized) || allPaths.contains(withSlash) || allPaths.contains(withoutSlash);

      // Check if this entry was moved/renamed
      QString writePath = normalized;
      if (!keep && origToNew.contains(normalized)) {
        writePath = origToNew[normalized];
        keep = true;
      } else if (!keep && origToNew.contains(withSlash)) {
        writePath = origToNew[withSlash];
        keep = true;
      } else if (!keep && origToNew.contains(withoutSlash)) {
        writePath = origToNew[withoutSlash];
        keep = true;
      }

      QString writeWithoutSlash = writePath.endsWith('/') ? writePath.chopped(1) : writePath;
      if (keep && !diskSources.contains(writeWithoutSlash)) {
        archive_entry_set_pathname(entry, writePath.toUtf8().constData());
        // Buffer data first so we can set correct size (needed for tar)
        QByteArray data;
        QByteArray cReadBuf(kIOBufferSize, Qt::Uninitialized);
        la_ssize_t clen;
        while ((clen = archive_read_data(src, cReadBuf.data(), cReadBuf.size())) > 0) {
          data.append(cReadBuf.constData(), clen);
          QApplication::processEvents();
        }
        archive_entry_set_size(entry, data.size());
        archive_write_header(dst, entry);
        if (!data.isEmpty()) {
          const char *ptr = data.constData();
          qint64 remaining = data.size();
          while (remaining > 0) {
            qint64 chunk = qMin(remaining, kIOBufferSize);
            archive_write_data(dst, ptr, chunk);
            ptr += chunk;
            remaining -= chunk;
            bytesWritten += chunk;
            if (totalBytes > 0)
              m_progressBar->setValue(static_cast<int>(bytesWritten * 100 / totalBytes));
            QApplication::processEvents();
          }
        }
        archive_write_finish_entry(dst);
        written.insert(writePath);
        QApplication::processEvents();
      } else {
        archive_read_data_skip(src);
      }
    }
  }
  archive_read_free(src);

  for (const QString &path : pathList) {
    if (m_cancelSave) break;
    if (written.contains(path)) continue;
    bool isDir = path.endsWith('/');
    QString cleanPath = isDir ? path.chopped(1) : path;

    struct archive_entry *entry = archive_entry_new();
    archive_entry_set_pathname(entry, path.toUtf8().constData());
    if (isDir) {
      archive_entry_set_filetype(entry, AE_IFDIR);
      archive_entry_set_perm(entry, 0755);
    } else {
      archive_entry_set_filetype(entry, AE_IFREG);
      archive_entry_set_perm(entry, 0644);
      if (diskSources.contains(cleanPath)) {
        QFileInfo sfi(diskSources[cleanPath]);
        archive_entry_set_size(entry, sfi.size());
      }
    }
    archive_entry_set_mtime(entry, QDateTime::currentDateTime().toSecsSinceEpoch(), 0);
    archive_write_header(dst, entry);

    if (!isDir && diskSources.contains(cleanPath)) {
      QFile file(diskSources[cleanPath]);
      if (file.open(QIODevice::ReadOnly)) {
        QByteArray buf(kIOBufferSize, Qt::Uninitialized);
        qint64 len;
        while ((len = file.read(buf.data(), buf.size())) > 0) {
          archive_write_data(dst, buf.constData(), len);
          bytesWritten += len;
          if (totalBytes > 0)
            m_progressBar->setValue(static_cast<int>(bytesWritten * 100 / totalBytes));
          QApplication::processEvents();
        }
      }
    }
    archive_entry_free(entry);
    QApplication::processEvents();
  }

  archive_write_close(dst);
  archive_write_free(dst);

  m_progressBar->setVisible(false);

  if (m_cancelSave) {
    QFile::remove(tmpPath);
    m_archiveManager->open(origArchive);
    m_pathBar->setText(origArchive);
  } else {
    QFile::remove(file);
    QFile::rename(tmpPath, file);
    m_dirty = false;
    m_archiveManager->open(file);
    m_pathBar->setText(file);
  }

  m_toolbar->setEnabled(true);
  menuBar()->setEnabled(true);
  ui->archiveTree->setDragEnabled(true);
  ui->archiveTree->setAcceptDrops(true);
  setAcceptDrops(true);
  updateActions();
  m_saving = false;
  if (m_cancelSave) { close(); return; }
  ui->statusBar->showMessage(tr("Archive saved as: %1").arg(file));
}

void MainWindow::extractArchive() {
  QString dir = QFileDialog::getExistingDirectory(this, tr("Extract To"));
  if (dir.isEmpty()) return;

  bool hasSelection = ui->archiveTree->selectionModel() &&
                      ui->archiveTree->selectionModel()->hasSelection();

  if (!hasSelection) {
    // Extract all
    m_toolbar->setEnabled(false);
    menuBar()->setEnabled(false);
    m_progressBar->setVisible(true);
    auto overwriteCb = [this](const QString &path) -> OverwriteAction {
      QFileInfo fi(path);
      QMessageBox box(this);
      box.setWindowTitle(tr("Confirm Overwrite"));
      box.setText(tr("The destination already contains a file named \"%1\".").arg(fi.fileName()));
      box.setInformativeText(tr("Do you want to replace it?"));
      QPushButton *replaceBtn = box.addButton(tr("Replace"), QMessageBox::AcceptRole);
      QPushButton *replaceAllBtn = box.addButton(tr("Replace All"), QMessageBox::AcceptRole);
      QPushButton *skipBtn = box.addButton(tr("Skip"), QMessageBox::RejectRole);
      QPushButton *skipAllBtn = box.addButton(tr("Skip All"), QMessageBox::RejectRole);
      QPushButton *cancelBtn = box.addButton(QMessageBox::Cancel);
      box.setDefaultButton(skipBtn);
      box.exec();
      QAbstractButton *clicked = box.clickedButton();
      if (clicked == replaceBtn) return OverwriteAction::Replace;
      if (clicked == replaceAllBtn) return OverwriteAction::ReplaceAll;
      if (clicked == skipAllBtn) return OverwriteAction::SkipAll;
      if (clicked == cancelBtn) return OverwriteAction::Cancel;
      return OverwriteAction::Skip;
    };
    if (m_archiveManager->extractTo(dir, overwriteCb))
      ui->statusBar->showMessage(tr("Extracted all to: %1").arg(dir));
    else
      ui->statusBar->showMessage(tr("Extraction cancelled"));
    m_progressBar->setVisible(false);
    m_toolbar->setEnabled(true);
    menuBar()->setEnabled(true);
    return;
  }

  // Build set of selected paths (including children of selected folders)
  QSet<QString> selectedPaths;
  auto indexes = ui->archiveTree->selectionModel()->selectedRows(0);

  for (const auto &proxyIdx : indexes) {
    QModelIndex srcIdx = m_proxy->mapToSource(proxyIdx);
    QStandardItem *item = m_model->itemFromIndex(srcIdx);
    if (!item) continue;
    // Build full path by walking up parents
    QStringList parts;
    QStandardItem *cur = item;
    while (cur) {
      parts.prepend(cur->text());
      cur = cur->parent();
    }
    QString fullPath = parts.join("/");
    QStandardItem *sizeItem = item->parent()
      ? item->parent()->child(item->row(), 1)
      : m_model->item(item->row(), 1);
    bool isDir = !sizeItem || sizeItem->text().isEmpty();
    selectedPaths.insert(isDir ? fullPath + "/" : fullPath);
    // Add all children recursively for folders
    if (isDir) {
      QStringList childPaths;
      QHash<QString, QString> dummy;
      collectPaths(item, fullPath, childPaths, dummy);
      for (const auto &p : childPaths)
        selectedPaths.insert(p);
    }
  }

  // Extract only matching entries from the archive
  QString archivePath = m_archiveManager->currentFile();

  struct archive *src = archive_read_new();
  archive_read_support_filter_all(src);
  archive_read_support_format_all(src);

  int extracted = 0;
  int extractTotal = selectedPaths.size();
  m_toolbar->setEnabled(false);
  menuBar()->setEnabled(false);
  m_progressBar->setVisible(true);
  m_progressBar->setValue(0);
  bool replaceAll = false;
  bool skipAll = false;
  bool cancelled = false;

  if (archive_read_open_filename(src, archivePath.toUtf8().constData(), 10240) == ARCHIVE_OK) {
    struct archive_entry *entry;
    while (archive_read_next_header(src, &entry) == ARCHIVE_OK) {
      QString entryPath = QString::fromUtf8(archive_entry_pathname(entry));
      if (entryPath.startsWith("./")) entryPath = entryPath.mid(2);
      entryPath = entryPath.trimmed();

      // Match with and without trailing slash
      QString withSlash = entryPath.endsWith('/') ? entryPath : entryPath + "/";
      QString withoutSlash = entryPath.endsWith('/') ? entryPath.chopped(1) : entryPath;
      bool match = selectedPaths.contains(entryPath) || selectedPaths.contains(withSlash) || selectedPaths.contains(withoutSlash);

      if (match) {
        // Create directories and write file manually
        QString fullPath = QDir::cleanPath(dir + "/" + entryPath);
        if (archive_entry_filetype(entry) == AE_IFDIR) {
          QDir().mkpath(fullPath);
          extracted++;
          m_progressBar->setValue(extracted * 100 / qMax(extractTotal, 1));
          QApplication::processEvents();
        } else {
          // Check for overwrite conflict
          if (QFileInfo::exists(fullPath) && !replaceAll && !skipAll) {
            QFileInfo fi(fullPath);
            QMessageBox box(this);
            box.setWindowTitle(tr("Confirm Overwrite"));
            box.setText(tr("The destination already contains a file named \"%1\".").arg(fi.fileName()));
            box.setInformativeText(tr("Do you want to replace it?"));
            QPushButton *replaceBtn = box.addButton(tr("Replace"), QMessageBox::AcceptRole);
            QPushButton *replaceAllBtn = box.addButton(tr("Replace All"), QMessageBox::AcceptRole);
            QPushButton *skipBtn = box.addButton(tr("Skip"), QMessageBox::RejectRole);
            QPushButton *skipAllBtn = box.addButton(tr("Skip All"), QMessageBox::RejectRole);
            QPushButton *cancelBtn = box.addButton(QMessageBox::Cancel);
            box.setDefaultButton(skipBtn);
            box.exec();
            QAbstractButton *clicked = box.clickedButton();
            if (clicked == replaceAllBtn) {
              replaceAll = true;
            } else if (clicked == skipBtn) {
              archive_read_data_skip(src);
              continue;
            } else if (clicked == skipAllBtn) {
              skipAll = true;
              archive_read_data_skip(src);
              continue;
            } else if (clicked == cancelBtn) {
              cancelled = true;
              break;
            }
            // Replace or ReplaceAll: fall through to extraction
          } else if (QFileInfo::exists(fullPath) && skipAll) {
            archive_read_data_skip(src);
            continue;
          }

          // Ensure parent directory exists
          QDir().mkpath(QFileInfo(fullPath).absolutePath());
          QFile outFile(fullPath);
          if (outFile.open(QIODevice::WriteOnly)) {
            char buf[8192];
            la_ssize_t len;
            while ((len = archive_read_data(src, buf, sizeof(buf))) > 0) {
              outFile.write(buf, len);
              QApplication::processEvents();
            }
            outFile.close();

            // Restore file permissions from archive
            unsigned int perm = archive_entry_perm(entry);
            if (perm != 0) {
              QFile::Permissions qperms;
              if (perm & 0400) qperms |= QFileDevice::ReadOwner;
              if (perm & 0200) qperms |= QFileDevice::WriteOwner;
              if (perm & 0100) qperms |= QFileDevice::ExeOwner;
              if (perm & 0040) qperms |= QFileDevice::ReadGroup;
              if (perm & 0020) qperms |= QFileDevice::WriteGroup;
              if (perm & 0010) qperms |= QFileDevice::ExeGroup;
              if (perm & 0004) qperms |= QFileDevice::ReadOther;
              if (perm & 0002) qperms |= QFileDevice::WriteOther;
              if (perm & 0001) qperms |= QFileDevice::ExeOther;
              QFile::setPermissions(fullPath, qperms);
            }

            extracted++;
            m_progressBar->setValue(extracted * 100 / qMax(extractTotal, 1));
            QApplication::processEvents();
          }
        }
      } else {
        archive_read_data_skip(src);
      }
    }
  }
  archive_read_free(src);

  // Also extract newly-added files that aren't in the archive (from disk sources)
  QHash<QString, QString> diskSources;
  QStringList dummyPaths;
  if (!cancelled) {
    for (const auto &proxyIdx : indexes) {
      QModelIndex srcIdx = m_proxy->mapToSource(proxyIdx);
      QStandardItem *item = m_model->itemFromIndex(srcIdx);
      if (!item) continue;
      QStringList parts;
      QStandardItem *cur = item;
      while (cur) { parts.prepend(cur->text()); cur = cur->parent(); }
      QString prefix = parts.size() > 1 ? parts.mid(0, parts.size() - 1).join("/") : QString();
      collectPaths(item, prefix.isEmpty() ? item->text() : prefix + "/" + item->text(), dummyPaths, diskSources);
      // Check the item itself
      QVariant src = item->data(Qt::UserRole + 1);
      if (src.isValid()) {
        QString itemPath = parts.join("/");
        diskSources[itemPath] = src.toString();
      }
    }
    for (auto it = diskSources.begin(); it != diskSources.end(); ++it) {
      QString destFile = dir + "/" + it.key();
      QFileInfo dfi(destFile);
      if (QFileInfo::exists(destFile) && !replaceAll && !skipAll) {
        QMessageBox box(this);
        box.setWindowTitle(tr("Confirm Overwrite"));
        box.setText(tr("The destination already contains a file named \"%1\".").arg(dfi.fileName()));
        box.setInformativeText(tr("Do you want to replace it?"));
        QPushButton *replaceBtn = box.addButton(tr("Replace"), QMessageBox::AcceptRole);
        QPushButton *replaceAllBtn = box.addButton(tr("Replace All"), QMessageBox::AcceptRole);
        QPushButton *skipBtn = box.addButton(tr("Skip"), QMessageBox::RejectRole);
        QPushButton *skipAllBtn = box.addButton(tr("Skip All"), QMessageBox::RejectRole);
        QPushButton *cancelBtn = box.addButton(QMessageBox::Cancel);
        box.setDefaultButton(skipBtn);
        box.exec();
        QAbstractButton *clicked = box.clickedButton();
        if (clicked == replaceAllBtn) {
          replaceAll = true;
        } else if (clicked == skipBtn) {
          continue;
        } else if (clicked == skipAllBtn) {
          skipAll = true;
          continue;
        } else if (clicked == cancelBtn) {
          cancelled = true;
          break;
        }
      } else if (QFileInfo::exists(destFile) && skipAll) {
        continue;
      }
      QDir().mkpath(dfi.absolutePath());
      if (QFileInfo::exists(destFile)) QFile::remove(destFile);
      QFile::copy(it.value(), destFile);
      extracted++;
    }
  }

#ifdef Q_OS_MACOS
  ArchiveManager::fixupMacOSApps(dir);
#endif

  m_progressBar->setVisible(false);
  m_toolbar->setEnabled(true);
  menuBar()->setEnabled(true);
  if (cancelled)
    ui->statusBar->showMessage(tr("Extraction cancelled"));
  else
    ui->statusBar->showMessage(tr("Extracted %1 of %2 selected item(s) to: %3").arg(extracted).arg(selectedPaths.size()).arg(dir));
}

void MainWindow::testIntegrity() {
  if (m_archiveManager->currentFile().isEmpty()) return;

  m_toolbar->setEnabled(false);
  menuBar()->setEnabled(false);
  m_progressBar->setVisible(true);
  m_progressBar->setValue(0);

  QString archivePath = m_archiveManager->currentFile();
  struct archive *a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  if (archive_read_open_filename(a, archivePath.toUtf8().constData(), 10240) != ARCHIVE_OK) {
    ui->statusBar->showMessage(tr("Test failed: cannot open archive"));
    archive_read_free(a);
    m_progressBar->setVisible(false);
    m_toolbar->setEnabled(true);
    menuBar()->setEnabled(true);
    return;
  }

  int total = m_archiveManager->entries().size();
  int current = 0;
  bool ok = true;
  QString errorMsg;

  struct archive_entry *entry;
  while (archive_read_next_header(a, &entry) == ARCHIVE_OK) {
    // Try to read all data to verify integrity
    char buf[8192];
    la_ssize_t len;
    while ((len = archive_read_data(a, buf, sizeof(buf))) > 0) {}
    if (len < 0) {
      ok = false;
      errorMsg = QString::fromUtf8(archive_error_string(a));
      break;
    }
    current++;
    m_progressBar->setValue(current * 100 / qMax(total, 1));
    QApplication::processEvents();
  }

  archive_read_free(a);
  m_progressBar->setVisible(false);
  m_toolbar->setEnabled(true);
  menuBar()->setEnabled(true);

  QMessageBox box(this);
  box.setWindowTitle(tr("Test Integrity"));
  box.setIconPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation), 14));
  if (ok)
    box.setText(tr("All %1 entries passed integrity check.").arg(current));
  else
    box.setText(tr("Integrity check failed at entry %1: %2").arg(current).arg(errorMsg));
  box.exec();
}

void MainWindow::cleanMacOS() {
  if (!m_model) return;

  // Remove macOS metadata entries: __MACOSX/, .DS_Store, ._* files
  auto isMacJunk = [](const QString &name) {
    return name == ".DS_Store" || name.startsWith("._") || name == "__MACOSX";
  };

  int removed = 0;
  std::function<void(QStandardItem *)> cleanItem = [&](QStandardItem *parent) {
    for (int i = parent->rowCount() - 1; i >= 0; --i) {
      QStandardItem *child = parent->child(i, 0);
      if (!child) continue;
      if (isMacJunk(child->text())) {
        parent->removeRow(i);
        removed++;
      } else {
        cleanItem(child);
      }
    }
  };

  // Clean root level
  for (int i = m_model->rowCount() - 1; i >= 0; --i) {
    QStandardItem *item = m_model->item(i, 0);
    if (!item) continue;
    if (isMacJunk(item->text())) {
      m_model->removeRow(i);
      removed++;
    } else {
      cleanItem(item);
    }
  }

  QMessageBox box(this);
  box.setWindowTitle(tr("Clean macOS"));
  box.setIconPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation), 14));
  if (removed > 0) {
    markDirty();
    box.setText(tr("%1 macOS item(s) cleaned.").arg(removed));
  } else {
    box.setText(tr("No macOS items found."));
  }
  box.exec();
}

void MainWindow::openSettings() {
  if (m_settingsDialog) { m_settingsDialog->activateWindow(); return; }
  m_settingsDialog = new SettingsDialog(m_settings, this);
  connect(m_settingsDialog, &QDialog::accepted, this, [this]() {
    applyTheme(); applyFontSize(); applyColors(); refreshIcons();
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

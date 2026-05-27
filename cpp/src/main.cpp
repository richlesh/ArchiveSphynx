// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include <QApplication>
#include <QFileOpenEvent>
#include <QStyleFactory>
#include <QPalette>
#include <QStyle>
#include <QIcon>
#include "MainWindow.h"
#include "SplashScreen.h"
#include "Settings.h"
#include "LicenseValidator.h"

class Application : public QApplication {
public:
  using QApplication::QApplication;
  MainWindow *mainWindow = nullptr;

protected:
  bool event(QEvent *event) override {
    if (event->type() == QEvent::FileOpen) {
      auto *foe = static_cast<QFileOpenEvent *>(event);
      if (mainWindow)
        mainWindow->openArchiveFile(foe->file());
      else
        m_pendingFile = foe->file();
      return true;
    }
    return QApplication::event(event);
  }

public:
  QString m_pendingFile;
};

static void applyAppTheme(const Settings &settings) {
  QString theme = settings.theme();
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
    p.setColor(QPalette::Disabled, QPalette::ButtonText, QColor("#666666"));
    p.setColor(QPalette::Disabled, QPalette::WindowText, QColor("#666666"));
    p.setColor(QPalette::Disabled, QPalette::Text, QColor("#666666"));
    qApp->setPalette(p);
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
    p.setColor(QPalette::Disabled, QPalette::ButtonText, QColor("#aaaaaa"));
    p.setColor(QPalette::Disabled, QPalette::WindowText, QColor("#aaaaaa"));
    p.setColor(QPalette::Disabled, QPalette::Text, QColor("#aaaaaa"));
    qApp->setPalette(p);
  } else {
    // System default
    qApp->setStyle(QStyleFactory::create("macOS"));
    qApp->setPalette(qApp->style()->standardPalette());
    qApp->setStyleSheet(QString());
  }
}

int main(int argc, char *argv[]) {
  Application app(argc, argv);
  app.setApplicationName("ArchiveSphynx");
  app.setApplicationVersion(APP_VERSION);
  app.setOrganizationName("Richard Lesh");
  app.setWindowIcon(QIcon(":/icons/app_icon.png"));

  Settings settings;
  settings.load();

  applyAppTheme(settings);

  LicenseValidator validator;
  bool licensed = validator.isValid(settings.userName(), settings.licenseKey());

  if (!licensed) {
    SplashScreen splash;
    splash.exec();
  }

  MainWindow mainWindow(settings, licensed);
  app.mainWindow = &mainWindow;
  mainWindow.show();

  // Open file from command line (Windows/Linux) or pending macOS FileOpen event
  QString fileToOpen = app.m_pendingFile;
  if (fileToOpen.isEmpty() && argc > 1)
    fileToOpen = QString::fromLocal8Bit(argv[1]);
  if (!fileToOpen.isEmpty())
    mainWindow.openArchiveFile(fileToOpen);

  return app.exec();
}

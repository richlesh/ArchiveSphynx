#include <QApplication>
#include <QStyleFactory>
#include <QPalette>
#include <QStyle>
#include "MainWindow.h"
#include "SplashScreen.h"
#include "Settings.h"
#include "LicenseValidator.h"

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
    qApp->setPalette(p);
  } else {
    // System default
    qApp->setStyle(QStyleFactory::create("macOS"));
    qApp->setPalette(qApp->style()->standardPalette());
    qApp->setStyleSheet(QString());
  }
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  app.setApplicationName("ArchiveSphynx");
  app.setApplicationVersion("1.2.0");
  app.setOrganizationName("Richard Lesh");

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
  mainWindow.show();

  return app.exec();
}

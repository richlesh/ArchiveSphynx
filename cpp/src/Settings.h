// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef SETTINGS_H
#define SETTINGS_H

#include <QByteArray>
#include <QColor>
#include <QSize>
#include <QString>

class Settings {
public:
  Settings();

  void load();
  void save();

  QColor buttonHighlightColor() const;
  void setButtonHighlightColor(const QColor &color);
  QColor treeSelectionColor() const;
  void setTreeSelectionColor(const QColor &color);
  QString theme() const;
  void setTheme(const QString &theme);
  QString fontSize() const;
  void setFontSize(const QString &size);
  QString userName() const;
  void setUserName(const QString &name);
  QString licenseKey() const;
  void setLicenseKey(const QString &key);
  QSize windowSize() const;
  void setWindowSize(const QSize &size);
  QByteArray headerState() const;
  void setHeaderState(const QByteArray &state);

private:
  QString settingsFilePath() const;

  QColor m_buttonHighlightColor{0, 0, 255};
  QColor m_treeSelectionColor{51, 153, 255};
  QString m_theme{"System"};
  QString m_fontSize{"Medium"};
  QString m_userName;
  QString m_licenseKey;
  QSize m_windowSize{1350, 600};
  QByteArray m_headerState;
};

#endif // SETTINGS_H

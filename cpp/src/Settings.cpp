// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "Settings.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>

Settings::Settings() {}

QString Settings::settingsFilePath() const {
  return QDir::homePath() + "/.archivesphynx-settings.json";
}

void Settings::load() {
  QFile file(settingsFilePath());
  if (!file.open(QIODevice::ReadOnly)) return;

  QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
  QJsonObject obj = doc.object();

  if (obj.contains("buttonHighlightColor"))
    m_buttonHighlightColor = QColor(obj.value("buttonHighlightColor").toString());
  if (obj.contains("treeSelectionColor"))
    m_treeSelectionColor = QColor(obj.value("treeSelectionColor").toString());
  if (obj.contains("theme"))
    m_theme = obj.value("theme").toString();
  if (obj.contains("fontSize"))
    m_fontSize = obj.value("fontSize").toString();
  m_userName = obj.value("userName").toString();
  m_licenseKey = obj.value("licenseKey").toString();
  if (obj.contains("windowWidth") && obj.contains("windowHeight"))
    m_windowSize = QSize(obj.value("windowWidth").toInt(), obj.value("windowHeight").toInt());
  if (obj.contains("headerState"))
    m_headerState = QByteArray::fromBase64(obj.value("headerState").toString().toLatin1());
}

void Settings::save() {
  QJsonObject obj;
  obj["buttonHighlightColor"] = m_buttonHighlightColor.name();
  obj["treeSelectionColor"] = m_treeSelectionColor.name();
  obj["theme"] = m_theme;
  obj["fontSize"] = m_fontSize;
  obj["userName"] = m_userName;
  obj["licenseKey"] = m_licenseKey;
  obj["windowWidth"] = m_windowSize.width();
  obj["windowHeight"] = m_windowSize.height();
  if (!m_headerState.isEmpty())
    obj["headerState"] = QString::fromLatin1(m_headerState.toBase64());

  QFile file(settingsFilePath());
  if (!file.open(QIODevice::WriteOnly)) return;
  file.write(QJsonDocument(obj).toJson());
}

QColor Settings::buttonHighlightColor() const { return m_buttonHighlightColor; }
void Settings::setButtonHighlightColor(const QColor &color) { m_buttonHighlightColor = color; }
QColor Settings::treeSelectionColor() const { return m_treeSelectionColor; }
void Settings::setTreeSelectionColor(const QColor &color) { m_treeSelectionColor = color; }
QString Settings::theme() const { return m_theme; }
void Settings::setTheme(const QString &theme) { m_theme = theme; }
QString Settings::fontSize() const { return m_fontSize; }
void Settings::setFontSize(const QString &size) { m_fontSize = size; }
QString Settings::userName() const { return m_userName; }
void Settings::setUserName(const QString &name) { m_userName = name; }
QString Settings::licenseKey() const { return m_licenseKey; }
void Settings::setLicenseKey(const QString &key) { m_licenseKey = key; }
QSize Settings::windowSize() const { return m_windowSize; }
void Settings::setWindowSize(const QSize &size) { m_windowSize = size; }
QByteArray Settings::headerState() const { return m_headerState; }
void Settings::setHeaderState(const QByteArray &state) { m_headerState = state; }

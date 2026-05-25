// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "SettingsDialog.h"
#include "ui_SettingsDialog.h"
#include "Settings.h"

#include <QColorDialog>
#include <QPushButton>
#include <QComboBox>
#include <QStyleFactory>

SettingsDialog::SettingsDialog(Settings &settings, QWidget *parent)
  : QDialog(parent), ui(new Ui::SettingsDialog), m_settings(settings) {
  ui->setupUi(this);
  setWindowTitle(tr("Settings"));
  setModal(true);

  // Ensure combo works in all themes
  ui->themeCombo->setStyle(QStyleFactory::create("Fusion"));
  ui->themeCombo->addItems({tr("System"), tr("Light"), tr("Dark")});
  int idx = ui->themeCombo->findText(m_settings.theme());
  if (idx >= 0) ui->themeCombo->setCurrentIndex(idx);

  ui->fontSizeCombo->setStyle(QStyleFactory::create("Fusion"));
  ui->fontSizeCombo->addItems({tr("Small"), tr("Medium"), tr("Large")});
  int fsIdx = ui->fontSizeCombo->findText(m_settings.fontSize());
  if (fsIdx >= 0) ui->fontSizeCombo->setCurrentIndex(fsIdx);

  m_buttonColor = m_settings.buttonHighlightColor();
  m_treeColor = m_settings.treeSelectionColor();

  updateSwatch(ui->btnColorPicker, m_buttonColor);
  updateSwatch(ui->treeColorPicker, m_treeColor);

  connect(ui->btnColorPicker, &QPushButton::clicked, this, &SettingsDialog::pickButtonColor);
  connect(ui->treeColorPicker, &QPushButton::clicked, this, &SettingsDialog::pickTreeColor);

  setFixedSize(sizeHint());
}

SettingsDialog::~SettingsDialog() {
  delete ui;
}

void SettingsDialog::updateSwatch(QPushButton *btn, const QColor &color) {
  btn->setStyleSheet(
    QString("background-color: %1; border: 1px solid #888; min-width: 60px;").arg(color.name()));
  btn->setText(color.name());
}

void SettingsDialog::pickButtonColor() {
  QColor c = QColorDialog::getColor(m_buttonColor, this, tr("Button Highlight Color"));
  if (c.isValid()) {
    m_buttonColor = c;
    updateSwatch(ui->btnColorPicker, c);
  }
}

void SettingsDialog::pickTreeColor() {
  QColor c = QColorDialog::getColor(m_treeColor, this, tr("Tree Selection Color"));
  if (c.isValid()) {
    m_treeColor = c;
    updateSwatch(ui->treeColorPicker, c);
  }
}

void SettingsDialog::accept() {
  m_settings.setTheme(ui->themeCombo->currentText());
  m_settings.setFontSize(ui->fontSizeCombo->currentText());
  m_settings.setButtonHighlightColor(m_buttonColor);
  m_settings.setTreeSelectionColor(m_treeColor);
  m_settings.save();
  QDialog::accept();
}

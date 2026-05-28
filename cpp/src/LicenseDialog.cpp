// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "LicenseDialog.h"
#include "ui_LicenseDialog.h"
#include "Settings.h"
#include "LicenseValidator.h"
#include "Utilities.h"

#include <QMessageBox>
#include <QPushButton>

LicenseDialog::LicenseDialog(Settings &settings, QWidget *parent)
  : QDialog(parent), ui(new Ui::LicenseDialog), m_settings(settings) {
  ui->setupUi(this);
  setWindowTitle(tr("License Key"));
  setFixedSize(sizeHint());
  setModal(true);

  ui->userNameEdit->setText(m_settings.userName());
  ui->licenseKeyEdit->setText(m_settings.licenseKey());

  auto *okBtn = ui->buttonBox->button(QDialogButtonBox::Ok);
  okBtn->setText(tr("Save"));
  auto validate = [this, okBtn]() {
    LicenseValidator v;
    bool valid = v.isValid(ui->userNameEdit->text().trimmed(),
                           ui->licenseKeyEdit->text().trimmed().toUpper());
    okBtn->setEnabled(valid);
    if (valid)
      okBtn->setStyleSheet(
        "QPushButton { background-color: #008800; color: white; }"
        "QPushButton:hover { background-color: #00cc00; }");
    else {
      bool dark = palette().window().color().lightness() < 128;
      okBtn->setStyleSheet(dark ? "QPushButton { background-color: #555; color: #888; }"
                                : "QPushButton { background-color: #ddd; color: #aaa; }");
    }
  };
  connect(ui->userNameEdit, &QLineEdit::textChanged, this, validate);
  connect(ui->licenseKeyEdit, &QLineEdit::textChanged, this, validate);
  validate();
}

LicenseDialog::~LicenseDialog() {
  delete ui;
}

void LicenseDialog::accept() {
  QString userName = ui->userNameEdit->text().trimmed();
  QString key = ui->licenseKeyEdit->text().trimmed().toUpper();

  LicenseValidator validator;
  if (validator.isValid(userName, key)) {
    m_settings.setUserName(userName);
    m_settings.setLicenseKey(key);
    m_settings.save();
    QDialog::accept();
  } else {
    QMessageBox box(this);
    box.setWindowTitle(tr("Invalid Key"));
    box.setText(tr("The license key is not valid for this user name."));
    box.setIconPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(64, 64, Qt::KeepAspectRatio, Qt::SmoothTransformation), 14));
    box.exec();
  }
}

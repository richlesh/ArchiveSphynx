#include "LicenseDialog.h"
#include "ui_LicenseDialog.h"
#include "Settings.h"
#include "LicenseValidator.h"

#include <QMessageBox>

LicenseDialog::LicenseDialog(Settings &settings, QWidget *parent)
  : QDialog(parent), ui(new Ui::LicenseDialog), m_settings(settings) {
  ui->setupUi(this);
  setWindowTitle(tr("License Key"));
  setFixedSize(sizeHint());
  setModal(true);

  ui->userNameEdit->setText(m_settings.userName());
  ui->licenseKeyEdit->setText(m_settings.licenseKey());
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
    QMessageBox::warning(this, tr("Invalid Key"), tr("The license key is not valid for this user name."));
  }
}

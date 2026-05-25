#include "LicenseValidator.h"

#include <QCryptographicHash>
#include <QMessageAuthenticationCode>

static const QByteArray LICENSE_SALT = "ArchiveSphynx-2026";

QString LicenseValidator::generate(const QString &userName) const {
  QByteArray input = userName.toLower().trimmed().toUtf8();
  QByteArray hmac = QMessageAuthenticationCode::hash(input, LICENSE_SALT, QCryptographicHash::Sha256);
  return QString::fromLatin1(hmac.toHex()).left(16).toUpper();
}

bool LicenseValidator::isValid(const QString &userName, const QString &licenseKey) const {
  if (userName.trimmed().isEmpty() || licenseKey.trimmed().isEmpty()) return false;
  QString expected = generate(userName);
  QString provided = licenseKey.toUpper().remove('-');
  return expected == provided;
}

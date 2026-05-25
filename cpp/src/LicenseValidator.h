#ifndef LICENSEVALIDATOR_H
#define LICENSEVALIDATOR_H

#include <QString>

class LicenseValidator {
public:
  bool isValid(const QString &userName, const QString &licenseKey) const;
  QString generate(const QString &userName) const;
};

#endif // LICENSEVALIDATOR_H

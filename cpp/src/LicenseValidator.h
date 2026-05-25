// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef LICENSEVALIDATOR_H
#define LICENSEVALIDATOR_H

#include <QString>

class LicenseValidator {
public:
  bool isValid(const QString &userName, const QString &licenseKey) const;
  QString generate(const QString &userName) const;
};

#endif // LICENSEVALIDATOR_H

// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef UTILITIES_H
#define UTILITIES_H

#include <QIcon>
#include <QPixmap>

QPixmap roundedPixmap(const QPixmap &src, int radius);
QIcon themedIcon(const QString &path);

#endif // UTILITIES_H

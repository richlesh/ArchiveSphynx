// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "Utilities.h"

#include <QPainter>
#include <QPainterPath>
#include <QPalette>
#include <QApplication>
#include <QImage>

QPixmap roundedPixmap(const QPixmap &src, int radius) {
  QPixmap result(src.size());
  result.fill(Qt::transparent);
  QPainter p(&result);
  p.setRenderHint(QPainter::Antialiasing);
  QPainterPath path;
  path.addRoundedRect(result.rect(), radius, radius);
  p.setClipPath(path);
  p.drawPixmap(0, 0, src);
  return result;
}

QIcon themedIcon(const QString &path) {
  QPixmap px(path);
  bool dark = qApp->palette().window().color().lightness() < 128;
  if (dark) {
    QImage img = px.toImage();
    img.invertPixels(QImage::InvertRgb);
    px = QPixmap::fromImage(img);
  }
  return QIcon(px);
}

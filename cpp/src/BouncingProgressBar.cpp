// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "BouncingProgressBar.h"
#include <QPainter>
#include <cmath>

BouncingProgressBar::BouncingProgressBar(QWidget *parent) : QProgressBar(parent) {
  m_timer.setInterval(16); // ~60fps
  connect(&m_timer, &QTimer::timeout, this, QOverload<>::of(&QWidget::update));
}

void BouncingProgressBar::paintEvent(QPaintEvent *event) {
  if (minimum() == 0 && maximum() == 0) {
    if (!m_animating) {
      m_elapsed.start();
      m_timer.start();
      m_animating = true;
    }

    // Compute position using elapsed time with sine easing for ping-pong
    qint64 ms = m_elapsed.elapsed();
    double t = static_cast<double>(ms % (kCycleDuration * 2)) / (kCycleDuration * 2);
    double pos = (1.0 - std::cos(t * M_PI * 2.0)) / 2.0;

    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    // Background trough
    p.setPen(Qt::NoPen);
    p.setBrush(palette().base());
    p.drawRoundedRect(rect(), height() / 2, height() / 2);

    // Bouncing pill
    int pillWidth = width() / 4;
    int x = static_cast<int>(pos * (width() - pillWidth));
    QRect pill(x, 0, pillWidth, height());
    p.setBrush(palette().highlight());
    p.drawRoundedRect(pill, height() / 2, height() / 2);
  } else {
    if (m_animating) {
      m_timer.stop();
      m_animating = false;
    }
    QProgressBar::paintEvent(event);
  }
}

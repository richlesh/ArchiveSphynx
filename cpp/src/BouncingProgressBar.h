// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef BOUNCINGPROGRESSBAR_H
#define BOUNCINGPROGRESSBAR_H

#include <QProgressBar>
#include <QElapsedTimer>
#include <QTimer>

class BouncingProgressBar : public QProgressBar {
  Q_OBJECT

public:
  explicit BouncingProgressBar(QWidget *parent = nullptr);

protected:
  void paintEvent(QPaintEvent *event) override;

private:
  QTimer m_timer;
  QElapsedTimer m_elapsed;
  bool m_animating = false;
  static constexpr int kCycleDuration = 1200; // ms per half-cycle
};

#endif // BOUNCINGPROGRESSBAR_H

// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef SPLASHSCREEN_H
#define SPLASHSCREEN_H

#include <QDialog>
#include <QTimer>

class SplashScreen : public QDialog {
  Q_OBJECT

public:
  explicit SplashScreen(QWidget *parent = nullptr);

protected:
  void paintEvent(QPaintEvent *event) override;
  void mousePressEvent(QMouseEvent *event) override;

private:
  QTimer m_timer;
};

#endif // SPLASHSCREEN_H

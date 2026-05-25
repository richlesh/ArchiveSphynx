#ifndef SPLASHSCREEN_H
#define SPLASHSCREEN_H

#include <QDialog>
#include <QTimer>

class SplashScreen : public QDialog {
  Q_OBJECT

public:
  explicit SplashScreen(QWidget *parent = nullptr);

protected:
  void mousePressEvent(QMouseEvent *event) override;

private:
  QTimer m_timer;
};

#endif // SPLASHSCREEN_H

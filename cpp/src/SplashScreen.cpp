#include "SplashScreen.h"

#include <QLabel>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QDesktopServices>
#include <QUrl>
#include <QPushButton>

SplashScreen::SplashScreen(QWidget *parent) : QDialog(parent) {
  setWindowTitle("ArchiveSphynx");
  setFixedSize(400, 250);
  setWindowFlags(Qt::Dialog | Qt::FramelessWindowHint);

  auto *layout = new QVBoxLayout(this);
  auto *title = new QLabel("<h1>ArchiveSphynx</h1>", this);
  title->setAlignment(Qt::AlignCenter);
  layout->addWidget(title);

  auto *msg = new QLabel(tr("This software is unregistered.\nPlease consider supporting development."), this);
  msg->setAlignment(Qt::AlignCenter);
  layout->addWidget(msg);

  auto *donateBtn = new QPushButton(tr("Donate"), this);
  connect(donateBtn, &QPushButton::clicked, this, []() {
    QDesktopServices::openUrl(QUrl("https://glowingcatsoftware.com"));
  });
  layout->addWidget(donateBtn, 0, Qt::AlignCenter);

  // Auto-dismiss after 20 seconds
  m_timer.setSingleShot(true);
  connect(&m_timer, &QTimer::timeout, this, &QDialog::accept);
  m_timer.start(20000);
}

void SplashScreen::mousePressEvent(QMouseEvent *event) {
  Q_UNUSED(event);
  accept();
}

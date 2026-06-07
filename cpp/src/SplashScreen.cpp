// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "SplashScreen.h"

#include <QApplication>
#include <QLabel>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QDesktopServices>
#include <QUrl>
#include <QPainter>
#include <QPainterPath>
#include "Utilities.h"

SplashScreen::SplashScreen(QWidget *parent) : QDialog(parent) {
  setWindowFlags(Qt::Dialog | Qt::FramelessWindowHint);
  setAttribute(Qt::WA_TranslucentBackground);
  setModal(true);

  auto *layout = new QVBoxLayout(this);
  layout->setAlignment(Qt::AlignCenter);
  layout->setSpacing(8);
  layout->setContentsMargins(30, 30, 30, 30);

  // App icon
  auto *iconLabel = new QLabel(this);
  iconLabel->setPixmap(roundedPixmap(QPixmap(":/icons/app_icon.png").scaled(128, 128, Qt::KeepAspectRatio, Qt::SmoothTransformation), 28));
  iconLabel->setAlignment(Qt::AlignCenter);
  layout->addWidget(iconLabel);

  layout->addSpacing(10);

  // App name
  auto *nameLabel = new QLabel("<b style='font-size:20px;'>ArchiveSphynx</b>", this);
  nameLabel->setAlignment(Qt::AlignCenter);
  layout->addWidget(nameLabel);

  // Version
  auto *versionLabel = new QLabel(tr("Version %1").arg(qApp->applicationVersion()), this);
  versionLabel->setAlignment(Qt::AlignCenter);
  layout->addWidget(versionLabel);

  layout->addSpacing(15);

  // Message with link
  auto *msgLabel = new QLabel(
    tr("If you enjoy using this product<br>"
       "please consider donating to help<br>"
       "fund this and other open source<br>"
       "projects at <a href='https://glowingcatsoftware.com' style='color:#4488ff;'>Glowing Cat Software</a>."),
    this);
  msgLabel->setAlignment(Qt::AlignCenter);
  msgLabel->setWordWrap(true);
  msgLabel->setOpenExternalLinks(true);
  layout->addWidget(msgLabel);

  // Auto-dismiss after 20 seconds
  m_timer.setSingleShot(true);
  connect(&m_timer, &QTimer::timeout, this, &QDialog::accept);
  m_timer.start(20000);

  adjustSize();
  setFixedSize(sizeHint());
}

void SplashScreen::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  p.setPen(Qt::NoPen);
  p.setBrush(palette().window());
  p.drawRoundedRect(rect(), 20, 20);
}

void SplashScreen::mousePressEvent(QMouseEvent *event) {
  QWidget *child = childAt(event->pos());
  if (auto *label = qobject_cast<QLabel *>(child))
    if (!label->text().contains("<a "))
      accept();
    else
      QDialog::mousePressEvent(event);
  else
    accept();
}

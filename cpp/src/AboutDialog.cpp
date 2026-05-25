// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "AboutDialog.h"
#include "ui_AboutDialog.h"

#include <QApplication>
#include <QDesktopServices>
#include <QUrl>
#include <QVBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QPainter>
#include <QPainterPath>
#include "Utilities.h"

AboutDialog::AboutDialog(bool licensed, QWidget *parent)
  : QDialog(parent), ui(nullptr) {
  setWindowFlags(Qt::Dialog | Qt::FramelessWindowHint);
  setAttribute(Qt::WA_TranslucentBackground);
  setFixedSize(280 , 420);
  setModal(true);

  auto *layout = new QVBoxLayout(this);
  layout->setAlignment(Qt::AlignCenter);
  layout->setSpacing(8);
  layout->setContentsMargins(15, 15, 15, 15);

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

  // Copyright
  auto *copyrightLabel = new QLabel(tr("\u00A92026 Richard Lesh"), this);
  copyrightLabel->setAlignment(Qt::AlignCenter);
  layout->addWidget(copyrightLabel);

  // Built with
  auto *builtLabel = new QLabel(tr("Built with Qt %1").arg(QT_VERSION_STR), this);
  builtLabel->setAlignment(Qt::AlignCenter);
  layout->addWidget(builtLabel);

  // Links
  auto *websiteLink = new QLabel("<a href='https://glowingcatsoftware.com' style='color:#4488ff;'>Glowing Cat Software</a>", this);
  websiteLink->setAlignment(Qt::AlignCenter);
  websiteLink->setOpenExternalLinks(true);
  layout->addWidget(websiteLink);

  auto *githubLink = new QLabel("<a href='https://github.com/richlesh/ArchiveSphynx/issues' style='color:#4488ff;'>Report issues on GitHub</a>", this);
  githubLink->setAlignment(Qt::AlignCenter);
  githubLink->setOpenExternalLinks(true);
  layout->addWidget(githubLink);

  layout->addSpacing(15);

  // OK button
  auto *okBtn = new QPushButton(tr("OK"), this);
  okBtn->setFixedWidth(100);
  okBtn->setStyleSheet("QPushButton { background-color: #4488ff; color: white; border-radius: 12px; padding: 8px; font-weight: bold; }");
  connect(okBtn, &QPushButton::clicked, this, &QDialog::accept);
  layout->addWidget(okBtn, 0, Qt::AlignCenter);

  if (licensed) {
    layout->addSpacing(10);

    // Thank you message (only for licensed users)
    auto *thanksLabel = new QLabel(tr("<span style='color:#4488ff;'>Thank you for donating to<br>Glowing Cat Software!</span>"), this);
    thanksLabel->setAlignment(Qt::AlignCenter);
    thanksLabel->setVisible(licensed);
    layout->addWidget(thanksLabel);
  }
}

AboutDialog::~AboutDialog() {
  delete ui;
}

void AboutDialog::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  p.setPen(Qt::NoPen);
  p.setBrush(palette().window());
  p.drawRoundedRect(rect(), 20, 20);
}

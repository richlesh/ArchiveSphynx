// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef LICENSEDIALOG_H
#define LICENSEDIALOG_H

#include <QDialog>

class Settings;
namespace Ui { class LicenseDialog; }

class LicenseDialog : public QDialog {
  Q_OBJECT

public:
  explicit LicenseDialog(Settings &settings, QWidget *parent = nullptr);
  ~LicenseDialog() override;

private slots:
  void accept() override;

private:
  Ui::LicenseDialog *ui;
  Settings &m_settings;
};

#endif // LICENSEDIALOG_H

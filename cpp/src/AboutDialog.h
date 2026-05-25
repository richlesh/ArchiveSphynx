// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef ABOUTDIALOG_H
#define ABOUTDIALOG_H

#include <QDialog>

namespace Ui { class AboutDialog; }

class AboutDialog : public QDialog {
  Q_OBJECT

public:
  explicit AboutDialog(bool licensed, QWidget *parent = nullptr);
  ~AboutDialog() override;

protected:
  void paintEvent(QPaintEvent *event) override;

private:
  Ui::AboutDialog *ui;
};

#endif // ABOUTDIALOG_H

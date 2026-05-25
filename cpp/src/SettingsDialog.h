#ifndef SETTINGSDIALOG_H
#define SETTINGSDIALOG_H

#include <QColor>
#include <QDialog>

class Settings;
namespace Ui { class SettingsDialog; }

class SettingsDialog : public QDialog {
  Q_OBJECT

public:
  explicit SettingsDialog(Settings &settings, QWidget *parent = nullptr);
  ~SettingsDialog() override;

private slots:
  void pickButtonColor();
  void pickTreeColor();
  void accept() override;

private:
  void updateSwatch(class QPushButton *btn, const QColor &color);

  Ui::SettingsDialog *ui;
  Settings &m_settings;
  QColor m_buttonColor;
  QColor m_treeColor;
};

#endif // SETTINGSDIALOG_H

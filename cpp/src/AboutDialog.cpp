#include "AboutDialog.h"
#include "ui_AboutDialog.h"

#include <QApplication>

AboutDialog::AboutDialog(bool licensed, QWidget *parent)
  : QDialog(parent), ui(new Ui::AboutDialog) {
  ui->setupUi(this);
  setWindowTitle(tr("About ArchiveSphynx"));
  setFixedSize(sizeHint());
  setModal(true);

  ui->versionLabel->setText(tr("Version %1").arg(qApp->applicationVersion()));
  ui->thanksLabel->setVisible(licensed);
  ui->thanksLabel->setText(tr("Thank you for supporting ArchiveSphynx!"));
}

AboutDialog::~AboutDialog() {
  delete ui;
}

// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#ifndef ARCHIVETREEVIEW_H
#define ARCHIVETREEVIEW_H

#include <QPersistentModelIndex>
#include <QTreeView>

class ArchiveTreeView : public QTreeView {
  Q_OBJECT

public:
  explicit ArchiveTreeView(QWidget *parent = nullptr);

protected:
  void startDrag(Qt::DropActions supportedActions) override;
  void dropEvent(QDropEvent *event) override;

private:
  void removeDraggedRows(const QList<QPersistentModelIndex> &rows);

  bool m_internalDrop = false;
};

#endif // ARCHIVETREEVIEW_H

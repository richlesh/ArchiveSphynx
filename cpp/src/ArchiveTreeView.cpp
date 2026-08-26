// Copyright (c) 2026, Richard Lesh. All Rights Reserved.
// License: GPL v3.0

#include "ArchiveTreeView.h"

#include <QDrag>
#include <QDropEvent>
#include <QMimeData>

#include <algorithm>

ArchiveTreeView::ArchiveTreeView(QWidget *parent) : QTreeView(parent) {}

void ArchiveTreeView::startDrag(Qt::DropActions supportedActions) {
  const QModelIndexList indexes = selectionModel()->selectedRows();
  if (indexes.isEmpty()) return;

  QMimeData *mimeData = model()->mimeData(indexes);
  if (!mimeData) return;

  // Remember what was dragged; an internal move has to delete the originals,
  // otherwise the drop leaves a duplicate behind. QTreeView normally does this
  // from its own startDrag(), which we are replacing here.
  QList<QPersistentModelIndex> dragged;
  dragged.reserve(indexes.size());
  for (const QModelIndex &idx : indexes)
    dragged.append(QPersistentModelIndex(idx));

  m_internalDrop = false;

  QDrag *drag = new QDrag(this);
  drag->setMimeData(mimeData);
  const Qt::DropAction result = drag->exec(supportedActions, Qt::MoveAction);

  if (result == Qt::MoveAction && m_internalDrop)
    removeDraggedRows(dragged);
}

void ArchiveTreeView::dropEvent(QDropEvent *event) {
  const bool fromSelf = (event->source() == this);
  QTreeView::dropEvent(event);
  if (fromSelf && event->isAccepted())
    m_internalDrop = true;
}

void ArchiveTreeView::removeDraggedRows(const QList<QPersistentModelIndex> &rows) {
  QAbstractItemModel *m = model();
  if (!m) return;

  QList<QPersistentModelIndex> valid;
  for (const QPersistentModelIndex &idx : rows)
    if (idx.isValid()) valid.append(idx);

  // Highest row first so removing one does not shift the rest.
  std::sort(valid.begin(), valid.end(),
            [](const QPersistentModelIndex &a, const QPersistentModelIndex &b) {
              return a.row() > b.row();
            });

  for (const QPersistentModelIndex &idx : valid) {
    // A parent removed earlier in this loop invalidates its children.
    if (idx.isValid())
      m->removeRow(idx.row(), idx.parent());
  }
}

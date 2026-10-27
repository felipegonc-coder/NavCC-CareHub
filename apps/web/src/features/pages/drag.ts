// Dragging entries around the sidebar. A drag's data can't be read until the drop, so the
// entry being dragged is kept here, where every tree and drop place can see it.
import { useState, type DragEvent } from 'react';
import { pageUrl } from './access';
import type { TreeNode } from './types';

let dragged: TreeNode | null = null;

export function startDrag(event: DragEvent, page: TreeNode) {
  dragged = page;
  event.dataTransfer.effectAllowed = 'move';
  // Dropped into another app, it's the page's link.
  event.dataTransfer.setData(
    'text/uri-list',
    new URL(pageUrl(page.id), window.location.origin).href,
  );
}

export const draggedPage = () => dragged;

export function endDrag() {
  dragged = null;
}

/** A place that takes a dragged entry, such as a space's name or Favorites. */
export function useDropZone(
  accepts: (page: TreeNode) => boolean,
  onDrop: (page: TreeNode) => void,
) {
  const [over, setOver] = useState(false);
  const zone = {
    onDragOver(event: DragEvent) {
      if (!dragged || !accepts(dragged)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave(event: DragEvent) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop(event: DragEvent) {
      const page = dragged;
      setOver(false);
      if (!page || !accepts(page)) return;
      event.preventDefault();
      endDrag();
      onDrop(page);
    },
  };
  return { over, zone };
}

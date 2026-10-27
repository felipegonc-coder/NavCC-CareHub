// Dragging entries and spaces around the sidebar. A drag's data can't be read until the drop, so
// what is being dragged is kept here, where every tree and drop place can see it.
import { pageUrl } from '@carehub/shared';
import { useState, type DragEvent } from 'react';
import type { SpacePlace } from './space-order';
import type { TreeNode } from './types';

let dragged: TreeNode | null = null;
let draggedSpace: string | null = null;

export function startDrag(event: DragEvent, page: TreeNode) {
  dragged = page;
  draggedSpace = null;
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
  draggedSpace = null;
}

/** Drags a space's row to another place in the person's order of spaces. */
export function startSpaceDrag(event: DragEvent, spaceId: string) {
  draggedSpace = spaceId;
  dragged = null;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-carehub-space', spaceId); // some browsers need data
}

/** A place that takes a dragged entry, such as a space's name or Favorites. */
export function useDropZone(
  accepts: (page: TreeNode) => boolean,
  onDrop: (page: TreeNode) => void,
) {
  const [over, setOver] = useState(false);
  const zone = {
    onDragOver(event: DragEvent) {
      // An entry inside the zone, such as a page in Private, takes the drop first.
      const takes = !event.defaultPrevented && dragged !== null && accepts(dragged);
      setOver(takes);
      if (!takes) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDragLeave(event: DragEvent) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop(event: DragEvent) {
      const page = dragged;
      setOver(false);
      if (event.defaultPrevented || !page || !accepts(page)) return;
      event.preventDefault();
      endDrag();
      onDrop(page);
    },
  };
  return { over, zone };
}

/** A space's row, taking another space dropped just above or below it. */
export function useSpaceDrop(
  spaceId: string,
  onDrop: (dropped: string, place: SpacePlace) => void,
) {
  const [place, setPlace] = useState<SpacePlace | null>(null);
  const placeOf = (event: DragEvent): SpacePlace => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };
  const zone = {
    onDragOver(event: DragEvent) {
      if (draggedSpace === null || draggedSpace === spaceId) {
        setPlace(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setPlace(placeOf(event));
    },
    onDragLeave(event: DragEvent) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlace(null);
    },
    onDrop(event: DragEvent) {
      const dropped = draggedSpace;
      setPlace(null);
      if (dropped === null || dropped === spaceId) return;
      event.preventDefault();
      endDrag();
      onDrop(dropped, placeOf(event));
    },
  };
  return { place, zone };
}

type Zone = ReturnType<typeof useSpaceDrop>['zone'];

/** One element taking both: a space's row takes pages and other spaces. */
export const bothZones = (first: Zone, second: Zone): Zone => ({
  onDragOver(event) {
    first.onDragOver(event);
    second.onDragOver(event);
  },
  onDragLeave(event) {
    first.onDragLeave(event);
    second.onDragLeave(event);
  },
  onDrop(event) {
    first.onDrop(event);
    second.onDrop(event);
  },
});

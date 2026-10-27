import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Id, Property, View, ViewPropertySetting } from '@carehub/databases';
import { clampWidth, dropTarget, type TableColumn } from './columns';
import { DRAG_START, followDrag } from './drag';
import type { ColumnChanges } from './header';
import { moveSetting, withSetting, withTableOptions } from './view-settings';

/** Makes a change to the view from the view with the changes so far in it, and saves it. */
export type ChangeView = (make: (current: View) => Partial<View>) => Promise<void>;

/** The view's property settings with one changed (Name, always shown, gets a visible one). */
export function settingsWith(
  current: View,
  property: Property,
  patch: Partial<Omit<ViewPropertySetting, 'propertyId'>>,
): ViewPropertySetting[] {
  const listedHere = current.properties.some((s) => s.propertyId === property.id);
  const full =
    !listedHere && property.config.type === 'title' ? { visible: true, ...patch } : patch;
  return withSetting(current.properties, property.id, full);
}

/**
 * The header's column tools: drag an edge to resize, drag a header to move it (a press opens its
 * menu), the column menus, the Properties menu and Wrap cells. `gridLeft` is the table's left edge.
 */
export function useColumnTools(changeView: ChangeView, gridLeft: () => number) {
  // A column's width while its edge is dragged, and until saving it is done.
  const [resize, setResize] = useState<{ propertyId: Id; width: number } | null>(null);
  // A header being dragged to a new place: where the pointer is, px from the table's left edge.
  const [moving, setMoving] = useState<{ propertyId: Id; x: number } | null>(null);
  const [menuFor, setMenuFor] = useState<Id | null>(null);
  const dragStop = useRef<(() => void) | null>(null);
  const dragged = useRef(false);

  useEffect(
    () => () => {
      dragStop.current?.();
      dragStop.current = null;
    },
    [],
  );

  const columnChanges = (column: TableColumn): ColumnChanges => ({
    width: (width) =>
      void changeView((v) => ({
        properties: settingsWith(v, column.property, { width: clampWidth(width) }),
      })),
    wrap: (wrap) =>
      void changeView((v) => ({ properties: settingsWith(v, column.property, { wrap }) })),
    freeze: (frozen) =>
      void changeView((v) => ({
        table: withTableOptions(v, { frozenUpTo: frozen ? column.property.id : null }),
      })),
    hide: () =>
      void changeView((v) => ({
        properties: settingsWith(v, column.property, { visible: false }),
      })),
  });

  const showColumn = (property: Property, shown: boolean) =>
    void changeView((v) => ({ properties: settingsWith(v, property, { visible: shown }) }));

  // "Wrap cells" is for every column: the columns' own wrap settings go.
  const wrapCells = (wrap: boolean) =>
    void changeView((v) => ({
      table: withTableOptions(v, { wrapCells: wrap }),
      properties: v.properties.map((setting) => {
        const next = { ...setting };
        delete next.wrap;
        return next;
      }),
    }));

  const gridX = (clientX: number) => clientX - gridLeft();

  const startResize = (event: PointerEvent<HTMLDivElement>, column: TableColumn) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragStop.current?.();
    const { property, width: start } = column;
    dragStop.current = followDrag(event.clientX, {
      move: (dx) => setResize({ propertyId: property.id, width: clampWidth(start + dx) }),
      end: (dx, _x, cancelled) => {
        dragStop.current = null;
        const width = clampWidth(start + dx);
        if (cancelled || width === start) {
          setResize(null);
          return;
        }
        setResize({ propertyId: property.id, width });
        void changeView((v) => ({ properties: settingsWith(v, property, { width }) })).then(() =>
          setResize((r) => (r?.propertyId === property.id ? null : r)),
        );
      },
    });
  };

  // Dragging a header moves the column; a press without a drag opens its menu (on click).
  const startMove = (
    event: PointerEvent<HTMLButtonElement>,
    column: TableColumn,
    columns: readonly TableColumn[],
  ) => {
    dragged.current = false;
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    if (column.property.config.type === 'title') return;
    dragStop.current?.();
    const propertyId = column.property.id;
    const startColumns = columns;
    dragStop.current = followDrag(event.clientX, {
      move: (dx, clientX) => {
        if (!dragged.current && Math.abs(dx) < DRAG_START) return;
        dragged.current = true;
        setMoving({ propertyId, x: gridX(clientX) });
      },
      end: (_dx, clientX, cancelled) => {
        dragStop.current = null;
        setMoving(null);
        if (!dragged.current || cancelled) return;
        const beforeId = dropTarget(startColumns, gridX(clientX));
        const order = startColumns.map((c) => c.property.id);
        const at = order.indexOf(propertyId);
        if (beforeId === propertyId || (beforeId !== null && order[at + 1] === beforeId)) return;
        if (beforeId === null && at === order.length - 1) return;
        void changeView((v) => ({ properties: moveSetting(v.properties, propertyId, beforeId) }));
      },
    });
  };

  const pressHeader = (column: TableColumn) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setMenuFor(column.property.id);
  };

  return {
    resize,
    moving,
    menuFor,
    setMenuFor,
    startResize,
    startMove,
    pressHeader,
    columnChanges,
    showColumn,
    wrapCells,
  };
}

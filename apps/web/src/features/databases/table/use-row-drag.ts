import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Id } from '@carehub/databases';
import { DRAG_START, followPointer } from './drag';
import type { Line, Section } from './lines';
import { isTopLevel } from './nesting';
import {
  rowDropAt,
  type MeasuredRow,
  type MeasuredSection,
  type RowDrop,
  type RowTarget,
} from './row-drop';

export interface RowDragInput {
  /** The table: places are px from its top edge. */
  grid: RefObject<HTMLDivElement | null>;
  sections: readonly Section[];
  /** The rows and the sections drawn now, by key. */
  rowEls: ReadonlyMap<string, HTMLDivElement>;
  sectionEls: ReadonlyMap<string, HTMLDivElement>;
  /** Sub-items are drawn under their parents: only top-level rows are places. */
  nested: boolean;
  /** No sort: rows land between rows. With a sort only the group changes. */
  manual: boolean;
  canDrag(line: Line): boolean;
  /** Moves the row to where it was let go (`among`: the rows of its section that are places). */
  move(line: Line, from: Section, target: RowTarget, among: readonly Id[]): void;
}

/**
 * Dragging a row's handle (4 px before it counts): where the row would land while it's dragged,
 * and the move when it's let go. Escape cancels; touch doesn't drag (a long press opens the
 * menu). `shown` is the row and its drop; `dragged` is true just after a drag, so the click that
 * ends it isn't a press.
 */
export function useRowDrag(input: RowDragInput) {
  const [shown, setShown] = useState<{ line: string; drop: RowDrop | null } | null>(null);
  const dragged = useRef(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
    },
    [],
  );

  const gridTop = () => input.grid.current?.getBoundingClientRect().top ?? 0;

  /** The sections and their rows as drawn now, px from the table's top edge. */
  const measure = (): MeasuredSection[] => {
    const { sections, rowEls, sectionEls, nested } = input;
    const top = gridTop();
    const measured: MeasuredSection[] = [];
    for (const section of sections) {
      const box = sectionEls.get(section.key)?.getBoundingClientRect();
      if (!box) continue;
      const rows: MeasuredRow[] = [];
      // With virtual rows some aren't drawn: the edge after a drawn one lands before the next.
      let edge: number | null = null;
      for (const line of section.collapsed ? [] : section.lines) {
        const place = !nested || isTopLevel(line.row);
        const r = rowEls.get(line.key)?.getBoundingClientRect();
        if (r) rows.push({ rowId: line.row.id, top: r.top - top, bottom: r.bottom - top, place });
        else if (edge !== null) rows.push({ rowId: line.row.id, top: edge, bottom: edge, place });
        edge = r ? r.bottom - top : null;
      }
      const last = section.lines.at(-1);
      measured.push({
        key: section.key,
        top: box.top - top,
        bottom: box.bottom - top,
        rows,
        // The end of the list is a place only when its last row is drawn and nothing is left to load.
        more: section.nextCursor !== null || (last !== undefined && !rowEls.has(last.key)),
      });
    }
    return measured;
  };

  // A press without a drag opens the row's menu (on click).
  const start = (event: PointerEvent<HTMLButtonElement>, line: Line, section: Section) => {
    dragged.current = false;
    if (!input.canDrag(line) || event.button !== 0 || event.pointerType === 'touch') return;
    stop.current?.();
    const { manual, nested, move } = input;
    const measured = measure();
    const from = { x: event.clientX, y: event.clientY };
    const dropAt = (y: number) => rowDropAt(measured, y - gridTop(), manual);
    let moved = false;
    let last: RowDrop | null = null;
    stop.current = followPointer(from, {
      move: (point) => {
        if (!moved && Math.hypot(point.x - from.x, point.y - from.y) < DRAG_START) return;
        moved = true;
        const drop = dropAt(point.y);
        if (
          last &&
          drop &&
          last.sectionKey === drop.sectionKey &&
          last.beforeRowId === drop.beforeRowId
        )
          return;
        last = drop;
        setShown({ line: line.key, drop });
      },
      end: (point, cancelled) => {
        stop.current = null;
        setShown(null);
        if (!moved) return;
        // The click after a drag isn't a press.
        dragged.current = true;
        window.setTimeout(() => {
          dragged.current = false;
        }, 0);
        const drop = dropAt(point.y);
        const among = section.lines
          .filter((l) => !nested || isTopLevel(l.row))
          .map((l) => l.row.id);
        if (!cancelled && drop) move(line, section, drop, among);
      },
    });
  };

  return { shown, start, dragged };
}

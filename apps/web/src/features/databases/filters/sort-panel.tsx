/**
 * The Sort panel (Databases spec 3.2 and 3.4): up to 10 sorts, applied in order. Drag a sort by its
 * handle (pointer events) or move it with the arrow keys; pick the property and the direction, or
 * remove it. Every change goes to updateView({ sorts }) at once.
 */
import { LIMITS, type Sort } from '@carehub/databases';
import { Button, cn, IconButton } from '@carehub/ui';
import { GripVertical, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { NativeSelect } from '../cells/controls';
import { FILTER_TEXT, SORT_TEXT } from './messages';
import {
  addSort,
  canAddSort,
  changeSort,
  dropIndex,
  moveSort,
  removeSort,
  sortableProperties,
} from './sort-model';
import type { PanelProps } from './types';

interface Drag {
  from: number;
  to: number;
  /** The rows' vertical middles when the drag started. */
  middles: number[];
}

export function SortPanel({ meta, view, actions, propertyIds }: PanelProps) {
  const candidates = useMemo(
    () => sortableProperties(meta.properties, propertyIds),
    [meta.properties, propertyIds],
  );
  const [saved, setSaved] = useState(view.sorts);
  const [sorts, setSorts] = useState(view.sorts);
  if (view.sorts !== saved) {
    setSaved(view.sorts);
    setSorts(view.sorts);
  }
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (focusAt === null) return;
    handles.current[focusAt]?.focus();
    setFocusAt(null);
  }, [focusAt]);

  const save = (next: Sort[]) => {
    const before = view.sorts;
    setSorts(next);
    actions.updateView({ sorts: next }).catch(() => setSorts(before));
  };
  const nameOf = (sort: Sort) =>
    meta.properties.find((p) => p.id === sort.propertyId)?.name ?? FILTER_TEXT.deletedProperty;
  const move = (from: number, to: number) => {
    const sort = sorts[from];
    if (!sort || to === from || to < 0 || to >= sorts.length) return;
    save(moveSort(sorts, from, to));
    setSaid(SORT_TEXT.moved(nameOf(sort), to + 1, sorts.length));
  };

  // Dragging: the pointer's moves are followed on the window so a fast drag isn't lost.
  const latest = useRef({ drag, move });
  useEffect(() => {
    latest.current = { drag, move };
  });
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const current = latest.current.drag;
      if (!current) return;
      const to = dropIndex(current.middles, e.clientY, current.from);
      if (to !== current.to) setDrag({ ...current, to });
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const current = latest.current.drag;
      setDrag(null);
      if (current)
        latest.current.move(current.from, dropIndex(current.middles, e.clientY, current.from));
    };
    const onCancel = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragging]);

  const startDrag = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const middles = sorts.map((_, i) => {
      const box = rows.current[i]?.getBoundingClientRect();
      return box ? box.top + box.height / 2 : 0;
    });
    setDrag({ from: index, to: index, middles });
  };
  const onHandleKey = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= sorts.length) return;
    e.preventDefault();
    move(index, to);
    setFocusAt(to);
  };

  if (!candidates.length && !sorts.length) {
    return <p className="text-small text-muted">{SORT_TEXT.noProperties}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {sorts.length === 0 ? (
        <p className="text-small text-muted">{SORT_TEXT.noSorts}</p>
      ) : (
        <ol aria-label={SORT_TEXT.sorts} className="flex flex-col gap-2">
          {sorts.map((sort, index) => {
            const name = nameOf(sort);
            const options = candidates.filter(
              (p) => p.id === sort.propertyId || !sorts.some((s) => s.propertyId === p.id),
            );
            const listed = options.some((p) => p.id === sort.propertyId);
            return (
              <li
                key={index}
                ref={(el) => {
                  rows.current[index] = el;
                }}
                data-sort-index={index}
                className={cn(
                  'flex items-center gap-2 rounded',
                  drag?.from === index && 'bg-fill',
                  drag && drag.to === index && drag.from !== index && 'ring-2 ring-ring',
                )}
              >
                <IconButton
                  ref={(el: HTMLButtonElement | null) => {
                    handles.current[index] = el;
                  }}
                  label={SORT_TEXT.move(name)}
                  size="sm"
                  className="cursor-grab touch-none"
                  onPointerDown={startDrag(index)}
                  onKeyDown={onHandleKey(index)}
                >
                  <GripVertical aria-hidden className="size-4" />
                </IconButton>
                <NativeSelect
                  aria-label={SORT_TEXT.property}
                  className="w-auto min-w-0 flex-1"
                  value={sort.propertyId}
                  onChange={(e) => save(changeSort(sorts, index, { propertyId: e.target.value }))}
                >
                  {!listed && (
                    <option value={sort.propertyId} disabled>
                      {name}
                    </option>
                  )}
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={SORT_TEXT.direction}
                  className="w-auto"
                  value={sort.direction}
                  onChange={(e) =>
                    save(
                      changeSort(sorts, index, {
                        direction: e.target.value === 'desc' ? 'desc' : 'asc',
                      }),
                    )
                  }
                >
                  <option value="asc">{SORT_TEXT.ascending}</option>
                  <option value="desc">{SORT_TEXT.descending}</option>
                </NativeSelect>
                <IconButton
                  label={SORT_TEXT.remove(name)}
                  size="sm"
                  onClick={() => save(removeSort(sorts, index))}
                >
                  <X aria-hidden className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}
      {sorts.length >= LIMITS.sorts && (
        <p className="text-label text-muted">{SORT_TEXT.maxSorts}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canAddSort(sorts, candidates)}
          onClick={() => save(addSort(sorts, candidates))}
        >
          <Plus aria-hidden className="size-4" />
          {SORT_TEXT.addSort}
        </Button>
        {sorts.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => save([])}>
            <Trash2 aria-hidden className="size-4" />
            {SORT_TEXT.deleteSort}
          </Button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

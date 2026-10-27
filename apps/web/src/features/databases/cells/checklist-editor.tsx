import { newId, type ChecklistItem, type Id } from '@carehub/databases';
import { validateValue } from '@carehub/databases/values';
import { Checkbox, cn, IconButton, Input } from '@carehub/ui';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EditorShell } from './editor-shell';
import { commitDetails } from './logic';
import { CELL_TEXT } from './messages';
import type { CellEditorProps, CellMove } from './types';

const readItems = (v: unknown): ChecklistItem[] => (Array.isArray(v) ? (v as ChecklistItem[]) : []);

/**
 * Checklist: tick, rename and remove items, and add new ones (up to 100, each up to 500
 * characters). Enter in "Add an item" adds what's typed; with nothing typed, Enter saves. Items
 * left blank are dropped when saving.
 */
export function ChecklistEditor({
  property,
  value,
  initialText,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const [items, setItems] = useState<ChecklistItem[]>(() => readItems(value));
  const [draft, setDraft] = useState(initialText ?? '');
  const [error, setError] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  useEffect(() => addInput.current?.focus(), []);

  const edit = (id: Id, patch: Partial<ChecklistItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setError(null);
  };
  const withDraft = (): ChecklistItem[] =>
    draft.trim() ? [...items, { id: newId(), text: draft.trim(), done: false }] : items;
  const addItem = () => {
    const next = withDraft();
    const res = validateValue(property, next);
    if (!res.ok) return setError(res.error);
    setItems(next);
    setDraft('');
    setError(null);
  };
  const commit = (move?: CellMove): boolean => {
    const res = validateValue(
      property,
      withDraft().filter((i) => i.text.trim()),
    );
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(value ?? null, res.value, move));
    return true;
  };
  const enter = (e: KeyboardEvent<HTMLElement>, action: () => unknown) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  return (
    <EditorShell
      label={property.name}
      commit={commit}
      onOutside={() => {
        if (!commit()) onCancel();
      }}
      onCancel={() => onCancel()}
      className="w-80 max-w-full gap-2 p-2"
    >
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item, i) => {
            const name = `${CELL_TEXT.item} ${i + 1}`;
            const shown = item.text.trim() || name;
            return (
              <li key={item.id} className="flex items-center gap-2">
                <Checkbox
                  checked={item.done}
                  aria-label={shown}
                  onCheckedChange={(on) => edit(item.id, { done: on === true })}
                  onKeyDown={(e) => enter(e, commit)}
                />
                <Input
                  value={item.text}
                  aria-label={name}
                  autoComplete="off"
                  onChange={(e) => edit(item.id, { text: e.target.value })}
                  onKeyDown={(e) => enter(e, commit)}
                  className={cn('h-8', item.done && 'text-muted line-through')}
                />
                <IconButton
                  label={CELL_TEXT.remove(shown)}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}
                >
                  <X aria-hidden className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        ref={addInput}
        value={draft}
        aria-label={CELL_TEXT.addItem}
        placeholder={CELL_TEXT.addItem}
        autoComplete="off"
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => enter(e, draft.trim() ? addItem : commit)}
        className="h-8"
      />
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </EditorShell>
  );
}
